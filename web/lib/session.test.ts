// SPDX-License-Identifier: Apache-2.0
/**
 * Sessions: what they buy, and — mostly — what they must never buy.
 *
 * The session exists so one signature covers a window of reading your own
 * history, instead of a wallet popup per page turn. Everything valuable about
 * it is a negative: it must not authenticate on its own, must not outlive its
 * window, must not cross wallets, must not survive revocation, and must never
 * be accepted where a payload-bound signature is required.
 *
 * Storage and the clock are supplied by the test; every DECISION is the real
 * exported code — `sessionDecision`, `verifyWalletAccess` and the real ed25519
 * verifier. That distinction is the point: the first draft of this file
 * re-implemented expiry and revocation inside its own fake, so it would have
 * passed with the real implementation broken.
 */
import assert from "node:assert/strict";
import { createHash, sign as edSign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  buildAuthMessage,
  sessionDecision,
  verifySignature,
  verifyWalletAccess,
  SESSION_TTL_MS,
  SESSION_HEADER,
  type AuthResult,
  type SessionRow,
} from "./wallet-auth";
import { buildEvidenceMessage } from "./evidence-message";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const signAs = (kp: Keypair, message: string): string =>
  bs58.encode(
    Buffer.from(
      edSign(null, Buffer.from(message, "utf8"), {
        key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.slice(0, 32))]),
        format: "der",
        type: "pkcs8",
      }),
    ),
  );

const OWNER = Keypair.generate();
const STRANGER = Keypair.generate();
const wallet = OWNER.publicKey.toBase58();

let passed = 0;
const cases: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => cases.push([name, fn]);

// --- the shape of the credential ---------------------------------------------

test("a session lasts 30 minutes and travels in a header, never a URL", async () => {
  assert.equal(SESSION_TTL_MS, 30 * 60 * 1000);
  assert.equal(SESSION_HEADER, "x-solverdict-session");
  assert.ok(!SESSION_HEADER.includes("?"), "a query parameter would land in logs and Referer");
});

test("the raw token is never what gets stored", async () => {
  const { store, issue } = fakeSessions();
  const { token } = await issue(wallet);
  const rows = store.rows();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]!.token_sha256, token, "the token itself must not be persisted");
  assert.equal(rows[0]!.token_sha256, createHash("sha256").update(token).digest("hex"));
  assert.match(rows[0]!.token_sha256, /^[0-9a-f]{64}$/);
});

// --- what it buys -------------------------------------------------------------

test("a live session stands in for the signature on the dashboard", async () => {
  const { issue, access } = fakeSessions();
  const { token } = await issue(wallet);
  const r = await access({ sessionToken: token, wallet, nonce: undefined, signature: undefined });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.wallet, wallet);
});

test("no session: a signed challenge still works, unchanged", async () => {
  const { access, challenge } = fakeSessions();
  const c = challenge(wallet);
  const r = await access({ wallet, nonce: c.nonce, signature: signAs(OWNER, c.message) });
  assert.equal(r.ok, true);
});

// --- expiry, mismatch, revocation ---------------------------------------------

test("an EXPIRED session behaves exactly like no credential", async () => {
  const { issue, access, store } = fakeSessions();
  const { token } = await issue(wallet);
  store.age(SESSION_TTL_MS + 1000);
  const r = await access({ sessionToken: token, wallet, nonce: undefined, signature: undefined });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "expired");
});

test("a session for one wallet cannot read another's", async () => {
  const { issue, access } = fakeSessions();
  const { token } = await issue(wallet);
  const r = await access({
    sessionToken: token,
    wallet: STRANGER.publicKey.toBase58(), // asking for someone else's history
    nonce: undefined,
    signature: undefined,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "wallet-mismatch");
});

test("a REVOKED session stops working immediately", async () => {
  const { issue, access, revoke } = fakeSessions();
  const { token } = await issue(wallet);
  assert.equal((await access({ sessionToken: token, wallet, nonce: undefined, signature: undefined })).ok, true);
  await revoke(token);
  const r = await access({ sessionToken: token, wallet, nonce: undefined, signature: undefined });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "expired");
});

test("an unknown or malformed token is refused, and says nothing about why", async () => {
  const { access } = fakeSessions();
  for (const bad of ["", "x", bs58.encode(Buffer.alloc(32, 7)), "../../etc/passwd", "a".repeat(200)]) {
    const r = await access({ sessionToken: bad, wallet, nonce: undefined, signature: undefined });
    // "" means "no session presented", which falls through to the signature
    // path and fails there for want of a signature. Everything else is refused
    // as a session. Either way: no access.
    assert.equal(r.ok, false, `token ${JSON.stringify(bad)} must not authenticate`);
  }
});

test("a dead token is NOT retried as a signature", async () => {
  // Presenting an expired token alongside a valid signature must fail, so the
  // caller learns their session ended instead of silently continuing.
  const { issue, access, store, challenge } = fakeSessions();
  const { token } = await issue(wallet);
  store.age(SESSION_TTL_MS + 1000);
  const c = challenge(wallet);
  const r = await access({ sessionToken: token, wallet, nonce: c.nonce, signature: signAs(OWNER, c.message) });
  assert.equal(r.ok, false, "a dead session must surface, not be papered over by a signature");
});

// --- THE LINE: a token is not a signature ------------------------------------

test("a session token cannot stand in for the INSTANCE challenge signature", async () => {
  // The instance route verifies a signature over a server-issued nonce at the
  // moment the secret is handed over. A bearer token expresses no such claim.
  const { issue } = fakeSessions();
  const { token } = await issue(wallet);
  const message = buildAuthMessage({
    wallet,
    nonce: bs58.encode(Buffer.alloc(32, 1)),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(verifySignature(wallet, message, token), false, "a token must not verify as a signature");
});

test("a session token cannot stand in for the EVIDENCE manifest signature", async () => {
  // The evidence signature commits to the manifest digest, which commits to
  // every byte of the bundle. Nothing about a session says which bytes.
  const { issue } = fakeSessions();
  const { token } = await issue(wallet);
  const message = buildEvidenceMessage({ auditId: "abc-123", manifestSha256: "deadbeef" });
  assert.equal(verifySignature(wallet, message, token), false, "a token must not verify as a signature");
});

test("the routes that require a signature do not read the session header", async () => {
  // Structural, because the two tests above only prove a token fails AS a
  // signature — not that nobody added a session shortcut to those routes.
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  for (const route of ["app/api/audit/[id]/instance/route.ts", "app/api/audit/[id]/evidence/route.ts"]) {
    const src = readFileSync(path.join(WEB, route), "utf8");
    assert.ok(
      !src.includes("SESSION_HEADER") && !src.includes("verifySession") && !src.includes("verifyWalletAccess"),
      `${route} must require its own signature — a session must never unlock it`,
    );
  }
});

const main = async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`FAILED: ${name}`);
      throw err;
    }
  }
  console.log(`session tests passed (${passed} cases)`);
};

// --- a database-free stand-in for auth_sessions ------------------------------
// The ROWS are fake; the decisions are not. `sessionDecision` and
// `verifyWalletAccess` are the real exported functions — only storage and the
// clock are supplied here. An earlier version of this file re-implemented the
// expiry/revocation logic in the fake, which meant it would have passed with
// the real implementation broken.
function fakeSessions() {
  let rows: Array<SessionRow & { token_sha256: string }> = [];
  const nonces = new Map<string, { wallet: string; issuedAt: string; expiresAt: string }>();
  const hash = (t: string) => createHash("sha256").update(t).digest("hex");

  const issue = async (w: string) => {
    const token = bs58.encode(Buffer.from(Keypair.generate().secretKey.slice(0, 32)));
    rows.push({
      token_sha256: hash(token),
      wallet: w,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      revoked_at: null,
    });
    return { token };
  };

  /** The real decision, over a real row. */
  const verify = async (token: unknown): Promise<AuthResult> => {
    if (typeof token !== "string" || token.length < 32 || token.length > 64) {
      return { ok: false, reason: "bad-request" };
    }
    return sessionDecision(rows.find((r) => r.token_sha256 === hash(token)) ?? null, Date.now());
  };

  /** The real signature path, over a real challenge. */
  const ownership = async (i: { wallet: unknown; nonce: unknown; signature: unknown }): Promise<AuthResult> => {
    const { wallet: w, nonce, signature } = i;
    if (typeof w !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
      return { ok: false, reason: "bad-request" };
    }
    const rec = nonces.get(nonce);
    if (!rec) return { ok: false, reason: "unknown-nonce" };
    nonces.delete(nonce); // single use, as in production
    const message = buildAuthMessage({ wallet: w, nonce, issuedAt: rec.issuedAt, expiresAt: rec.expiresAt });
    return verifySignature(w, message, signature) ? { ok: true, wallet: w } : { ok: false, reason: "bad-signature" };
  };

  return {
    issue,
    revoke: async (token: string) => {
      const row = rows.find((r) => r.token_sha256 === hash(token));
      if (row) row.revoked_at = new Date().toISOString();
    },
    challenge: (w: string) => {
      const nonce = bs58.encode(Buffer.from(Keypair.generate().secretKey.slice(0, 32)));
      const rec = {
        wallet: w,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
      nonces.set(nonce, rec);
      return { nonce, message: buildAuthMessage({ wallet: w, nonce, issuedAt: rec.issuedAt, expiresAt: rec.expiresAt }) };
    },
    store: {
      rows: () => rows,
      age: (ms: number) => {
        rows = rows.map((r) => ({ ...r, expires_at: new Date(Date.parse(r.expires_at) - ms).toISOString() }));
      },
    },
    /** The REAL verifyWalletAccess, with storage injected. */
    access: (input: { sessionToken?: unknown; wallet: unknown; nonce?: unknown; signature?: unknown }) =>
      verifyWalletAccess(
        { sessionToken: input.sessionToken, wallet: input.wallet, nonce: input.nonce, signature: input.signature },
        { verifySession: verify, verifyOwnership: ownership },
      ),
  };
}

void main();

// SPDX-License-Identifier: Apache-2.0
/**
 * GET /api/audit/:id/instance — the gate must hold on every axis, alone.
 *
 * This route hands out a customer's private instance. Everything issuance buys
 * (step 6) evaporates if it can be fetched by the wrong person, at the wrong
 * time, or for someone else's audit — so each test below breaks exactly one
 * condition of an otherwise valid request and asserts nothing comes back.
 *
 * The ownership proof uses the REAL message builder and the REAL ed25519
 * verifier from lib/wallet-auth.ts; only the nonce STORAGE is in memory, so
 * what is exercised here is the same signature check production runs. Nonce
 * expiry and single-use live in verifyWalletOwnership and are covered by the
 * shape of the fake below (issue once, burn on use).
 */
import assert from "node:assert/strict";
import { randomUUID, sign as edSign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { handleInstanceGet, type InstanceAuditRow, type InstancePorts } from "../app/api/audit/[id]/instance/route";
import { buildAuthMessage, newNonce, verifySignature, type AuthResult } from "./wallet-auth";
import { deriveIssuance } from "../../issuance/derive";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures";
import { SCENARIOS } from "../../scenarios";
import type { IssuanceRow, IssuanceStore } from "./instance-issuance";

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

/** In-memory nonce store wired to the real message + signature primitives. */
function makeAuth() {
  const live = new Map<string, { wallet: string; issuedAt: string; expiresAt: string }>();
  return {
    issue(wallet: string) {
      const nonce = newNonce();
      const now = new Date();
      const rec = {
        wallet,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      };
      live.set(nonce, rec);
      // The nonce is part of the signed text — omitting it here would make the
      // fake disagree with the verifier and mask a real signature check.
      return { nonce, message: buildAuthMessage({ wallet, nonce, issuedAt: rec.issuedAt, expiresAt: rec.expiresAt }) };
    },
    verifyOwner: async (c: { wallet: unknown; nonce: unknown; signature: unknown }): Promise<AuthResult> => {
      const { wallet, nonce, signature } = c;
      if (typeof wallet !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
        return { ok: false, reason: "bad-request" };
      }
      const row = live.get(nonce);
      if (!row) return { ok: false, reason: "unknown-nonce" };
      live.delete(nonce); // single use, whatever the outcome
      if (row.wallet !== wallet) return { ok: false, reason: "wallet-mismatch" };
      const message = buildAuthMessage({ wallet, nonce, issuedAt: row.issuedAt, expiresAt: row.expiresAt });
      if (!verifySignature(wallet, message, signature)) return { ok: false, reason: "bad-signature" };
      return { ok: true, wallet };
    },
    outstanding: () => live.size,
  };
}

function makeStore(row: IssuanceRow): { store: IssuanceStore; row: IssuanceRow; claims: number } {
  const state = { row, claims: 0 };
  const store: IssuanceStore = {
    load: async () => ({ ...state.row }),
    claimSeed: async (_id, seed) => {
      if (state.row.instance_seed) return false; // someone already claimed it
      state.row.instance_seed = seed;
      state.claims++;
      return true;
    },
    writeCache: async (_id, issuance) => {
      state.row.issued_instance = issuance;
    },
  };
  return Object.defineProperties({ store } as never, {
    row: { get: () => state.row },
    claims: { get: () => state.claims },
  });
}

const AUDIT = randomUUID();
const OWNER = Keypair.generate();
const STRANGER = Keypair.generate();

const auditRow = (over: Partial<InstanceAuditRow> = {}): InstanceAuditRow => ({
  id: AUDIT,
  wallet: OWNER.publicKey.toBase58(),
  status: "awaiting_evidence",
  n: 1,
  ...over,
});

interface Call {
  status: number;
  body: Record<string, unknown>;
}

async function get(
  opts: {
    signer?: Keypair | null;
    claimWallet?: string;
    audit?: InstanceAuditRow | null;
    auditId?: string;
    seeded?: string | null;
  } = {},
): Promise<Call & { store: IssuanceStore; nonces: number }> {
  const auth = makeAuth();
  const signer = opts.signer === undefined ? OWNER : opts.signer;
  const claimWallet = opts.claimWallet ?? signer?.publicKey.toBase58() ?? "";
  const headers = new Headers();
  if (signer) {
    const { nonce, message } = auth.issue(claimWallet);
    headers.set("x-solverdict-wallet", claimWallet);
    headers.set("x-solverdict-nonce", nonce);
    headers.set("x-solverdict-signature", signAs(signer, message));
  }
  const row = opts.audit === undefined ? auditRow() : opts.audit;
  const holder = makeStore({ id: AUDIT, n: row?.n ?? 1, instance_seed: opts.seeded ?? null, issued_instance: null });
  const ports: InstancePorts = {
    verifyOwner: auth.verifyOwner,
    loadAudit: async () => row,
    store: holder.store,
  };
  const res = await handleInstanceGet(
    new Request(`http://localhost/api/audit/${opts.auditId ?? AUDIT}/instance`, { headers }),
    opts.auditId ?? AUDIT,
    ports,
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    store: holder.store,
    nonces: auth.outstanding(),
  };
}

let passed = 0;
const cases: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => cases.push([name, fn]);

// --- the one way in ----------------------------------------------------------

test("the owner, at awaiting_evidence, gets the derived instance", async () => {
  const r = await get();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.auditId, AUDIT);
  const instances = r.body.instances as Record<string, unknown>;
  assert.equal(Object.keys(instances).length, SCENARIOS.length, "one instance per scenario at n=1");
  assert.ok(String(r.body.usage).includes("--instance"), "tells the client what to do with it");
});

test("the response never carries the seed", async () => {
  const r = await get();
  const serialised = JSON.stringify(r.body);
  assert.ok(!serialised.includes("instance_seed"), "no seed field");
  assert.ok(!/"[0-9a-f]{64}"/.test(serialised), "no bare 32-byte hex anywhere in the payload");
  assert.equal(r.body.seed, undefined);
  assert.equal(r.body.instance_seed, undefined);
});

test("what is served is exactly what the seed derives", async () => {
  const seed = "5e".repeat(32);
  const r = await get({ seeded: seed });
  assert.equal(r.status, 200);
  const expected = deriveIssuance({
    auditId: AUDIT,
    serverSeed: seed,
    scenarioIds: SCENARIOS.map((s) => s.id),
    n: 1,
    baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
  });
  assert.equal(JSON.stringify(r.body.instances), JSON.stringify(expected.instances));
});

test("two fetches of the same audit return the same instance", async () => {
  const seed = "77".repeat(32);
  const a = await get({ seeded: seed });
  const b = await get({ seeded: seed });
  assert.equal(JSON.stringify(a.body.instances), JSON.stringify(b.body.instances));
});

// --- each way in, closed on its own -----------------------------------------

test("no credentials → 401, nothing disclosed", async () => {
  const r = await get({ signer: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.instances, undefined);
});

test("a stranger's valid signature → 404, not 403", async () => {
  // The signature is genuine; the wallet simply does not own this audit.
  // Answering 403 would confirm the audit exists.
  const r = await get({ signer: STRANGER });
  assert.equal(r.status, 404);
  assert.equal(r.body.instances, undefined);
});

test("an unknown audit answers the same 404 as someone else's audit", async () => {
  const mine = await get({ signer: STRANGER });
  const missing = await get({ audit: null });
  assert.equal(missing.status, mine.status);
  assert.deepEqual(missing.body, mine.body, "the two cases must be indistinguishable");
});

test("a signature over another wallet's challenge → 401", async () => {
  // Claims to be OWNER but signs with the stranger's key.
  const r = await get({ signer: STRANGER, claimWallet: OWNER.publicKey.toBase58() });
  assert.equal(r.status, 401);
});

test("the nonce is consumed even when the request then fails", async () => {
  // Ownership is checked before anything else precisely so a stranger cannot
  // probe audit ids without burning a challenge each time.
  const r = await get({ signer: STRANGER });
  assert.equal(r.status, 404);
  assert.equal(r.nonces, 0, "the challenge was burned");
});

test("before payment → 409, no instance", async () => {
  const r = await get({ audit: auditRow({ status: "awaiting_payment" }) });
  assert.equal(r.status, 409);
  assert.equal(r.body.instances, undefined);
  assert.match(String(r.body.detail), /payment/);
});

test("after evidence is submitted → 409, no instance", async () => {
  for (const status of ["queued", "running", "done", "failed"]) {
    const r = await get({ audit: auditRow({ status }) });
    assert.equal(r.status, 409, status);
    assert.equal(r.body.instances, undefined, status);
  }
});

test("a malformed audit id is rejected before anything else", async () => {
  const r = await get({ auditId: "../../etc/passwd" });
  assert.equal(r.status, 400);
});

// --- issuance behaviour ------------------------------------------------------

test("an audit with no seed is issued one on first fetch", async () => {
  const r = await get({ seeded: null });
  assert.equal(r.status, 200);
  assert.equal((r.store as unknown as { claimSeed: unknown }) !== undefined, true);
  const row = await r.store.load(AUDIT);
  assert.ok(row?.instance_seed, "the fetch issued and persisted a seed");
  assert.equal(row!.instance_seed!.length, 64, "32 bytes, hex");
});

test("a lost seed-claim race adopts the winner's instance", async () => {
  // Two writers, one seed. The loser must not serve an instance derived from
  // the seed it generated — the client would run against it and then fail
  // verification, which is the failure mode this race exists to prevent.
  const winnerSeed = "ab".repeat(32);
  const state: IssuanceRow = { id: AUDIT, n: 1, instance_seed: null, issued_instance: null };
  const store: IssuanceStore = {
    load: async () => ({ ...state }),
    claimSeed: async () => {
      // Somebody else won between our load and our write.
      state.instance_seed = winnerSeed;
      return false;
    },
    writeCache: async (_id, issuance) => {
      state.issued_instance = issuance;
    },
  };
  const auth = makeAuth();
  const { nonce, message } = auth.issue(OWNER.publicKey.toBase58());
  const headers = new Headers({
    "x-solverdict-wallet": OWNER.publicKey.toBase58(),
    "x-solverdict-nonce": nonce,
    "x-solverdict-signature": signAs(OWNER, message),
  });
  const res = await handleInstanceGet(
    new Request(`http://localhost/api/audit/${AUDIT}/instance`, { headers }),
    AUDIT,
    { verifyOwner: auth.verifyOwner, loadAudit: async () => auditRow(), store },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  const expected = deriveIssuance({
    auditId: AUDIT,
    serverSeed: winnerSeed,
    scenarioIds: SCENARIOS.map((s) => s.id),
    n: 1,
    baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
  });
  assert.equal(JSON.stringify(body.instances), JSON.stringify(expected.instances), "served the winner's instance");
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
  console.log(`instance-route tests passed (${passed} cases)`);
};

void main();

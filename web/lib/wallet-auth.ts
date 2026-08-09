// SPDX-License-Identifier: Apache-2.0
/**
 * Wallet-ownership proof for private endpoints (finding #9).
 *
 * THE HOLE THIS CLOSES. `/api/audits?wallet=<pubkey>` trusted its own query
 * parameter. Pubkeys are public by construction, so anyone could list a
 * wallet's entire audit history — and each row carries the audit UUID, which is
 * the ONLY gate on `/api/audit/<id>`. That endpoint returns the full result,
 * the submitter's email and the payment signature. Knowing a pubkey therefore
 * read every private audit that wallet had run, defeating the product's stated
 * model ("the audit id is an unguessable UUID, so the link is the only key").
 *
 * THE PROOF. Standard Solana message signing: the caller signs a
 * server-issued, single-use nonce with the wallet's key, and the server
 * verifies the ed25519 signature against the pubkey. Someone who knows the
 * pubkey but cannot sign gets nothing.
 *
 * WHY node:crypto AND NOT tweetnacl. Both verify the identical primitive
 * (ed25519, RFC 8032 — exactly what a Solana wallet's `signMessage` produces).
 * tweetnacl is not currently a dependency, and adding one to a
 * security-critical verification path is a supply-chain cost with no
 * cryptographic benefit: Node ships the verifier. A raw 32-byte Solana pubkey
 * becomes a usable key by prefixing the fixed Ed25519 SPKI header (RFC 8410).
 * Swapping in tweetnacl later is a two-line change inside `verifySignature`.
 *
 * Everything except the two Supabase calls is pure and unit-tested.
 */
import { createPublicKey, verify as cryptoVerify, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { supabaseAdmin } from "./supabase";

/** How long an issued nonce stays usable. Short: the user signs immediately. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** Base58 pubkey shape (32 bytes encodes to 32–44 chars). */
export const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Domain the signed message is bound to, so a signature cannot be replayed elsewhere. */
const DOMAIN = "solverdict.vercel.app";

/** Fixed ASN.1 SPKI prefix for an Ed25519 public key (RFC 8410 §4). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * The exact text the wallet signs.
 *
 * Human-readable on purpose: the user sees it in their wallet and can tell what
 * they are authorising. It binds the domain (no cross-site replay), the wallet
 * (no swapping in another key), the nonce (single use) and the expiry.
 *
 * The server NEVER trusts a client-supplied message — it rebuilds this string
 * from the stored nonce row and verifies against that.
 */
export function buildAuthMessage(args: {
  wallet: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${DOMAIN} wants you to prove you own this Solana account:`,
    args.wallet,
    "",
    "Signing proves ownership so your private audit history can be shown to you.",
    "This does not authorise any transaction and moves no funds.",
    "",
    `Nonce: ${args.nonce}`,
    `Issued At: ${args.issuedAt}`,
    `Expires At: ${args.expiresAt}`,
  ].join("\n");
}

/**
 * Verifies an ed25519 signature over `message` by `walletBase58`.
 *
 * Returns a boolean and never throws: malformed base58, a wrong-length key or a
 * wrong-length signature are all just "not verified". Callers must not be able
 * to distinguish failure modes.
 */
export function verifySignature(walletBase58: string, message: string, signatureBase58: string): boolean {
  try {
    if (!BASE58_PUBKEY.test(walletBase58)) return false;
    const pub = bs58.decode(walletBase58);
    if (pub.length !== 32) return false;
    const sig = bs58.decode(signatureBase58);
    if (sig.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]),
      format: "der",
      type: "spki",
    });
    // `null` algorithm is required for Ed25519 (the hash is built into the scheme).
    return cryptoVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig));
  } catch {
    return false;
  }
}

export interface IssuedNonce {
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

/** A 32-byte random nonce, base58 so it reads like the rest of the ecosystem. */
export function newNonce(): string {
  return bs58.encode(randomBytes(32));
}

/**
 * Issues and stores a single-use nonce for `wallet`.
 *
 * Opportunistically prunes expired rows so an abandoned sign-in cannot
 * accumulate. Throws on a storage failure — the caller must fail closed.
 */
export async function issueNonce(wallet: string): Promise<IssuedNonce> {
  const nonce = newNonce();
  const now = new Date();
  const expires = new Date(now.getTime() + NONCE_TTL_MS);
  const issuedAt = now.toISOString();
  const expiresAt = expires.toISOString();

  const { error } = await supabaseAdmin()
    .from("auth_nonces")
    .insert({ nonce, wallet, issued_at: issuedAt, expires_at: expiresAt });
  if (error) throw new Error(error.message);

  try {
    await supabaseAdmin().rpc("prune_expired_nonces");
  } catch {
    /* housekeeping only — never fail an issue on it */
  }

  return { nonce, message: buildAuthMessage({ wallet, nonce, issuedAt, expiresAt }), issuedAt, expiresAt };
}

export type AuthFailure =
  | "bad-request"
  | "unknown-nonce"
  | "wallet-mismatch"
  | "expired"
  | "bad-signature"
  | "storage";

export type AuthResult = { ok: true; wallet: string } | { ok: false; reason: AuthFailure };

/**
 * Consumes a nonce and verifies the signature over the message the server
 * rebuilds for it.
 *
 * ORDER MATTERS. The nonce row is DELETED before the signature is checked, so a
 * captured signature cannot be replayed even against a failed attempt — one
 * issued nonce buys exactly one verification attempt. The cost is that a
 * genuine user who fumbles a signature must request a new nonce, which is the
 * correct trade for an auth path.
 */
export async function verifyWalletOwnership(input: {
  wallet: unknown;
  nonce: unknown;
  signature: unknown;
}): Promise<AuthResult> {
  const { wallet, nonce, signature } = input;
  if (
    typeof wallet !== "string" ||
    typeof nonce !== "string" ||
    typeof signature !== "string" ||
    !BASE58_PUBKEY.test(wallet) ||
    nonce.length < 32 ||
    nonce.length > 64 ||
    signature.length < 64 ||
    signature.length > 128
  ) {
    return { ok: false, reason: "bad-request" };
  }

  let row: { wallet: string; issued_at: string; expires_at: string } | null;
  try {
    const { data, error } = await supabaseAdmin()
      .from("auth_nonces")
      .select("wallet, issued_at, expires_at")
      .eq("nonce", nonce)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = (data as typeof row) ?? null;
  } catch {
    return { ok: false, reason: "storage" };
  }

  if (!row) return { ok: false, reason: "unknown-nonce" };

  // Single use: burn it now, whatever the outcome below.
  try {
    await supabaseAdmin().from("auth_nonces").delete().eq("nonce", nonce);
  } catch {
    return { ok: false, reason: "storage" };
  }

  if (row.wallet !== wallet) return { ok: false, reason: "wallet-mismatch" };
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: "expired" };

  const message = buildAuthMessage({
    wallet,
    nonce,
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  });
  if (!verifySignature(wallet, message, signature)) return { ok: false, reason: "bad-signature" };

  return { ok: true, wallet };
}

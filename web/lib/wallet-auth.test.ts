// SPDX-License-Identifier: Apache-2.0
/**
 * Wallet-ownership proof (finding #9). No network, no Supabase, no keys — the
 * signatures below are produced by real ed25519 over real Solana keypairs.
 *
 * The property under test is the one the whole fix rests on: a caller who knows
 * a pubkey but cannot sign for it gets nothing. Everything else — message
 * binding, expiry, single use — exists to keep that property true.
 */
import assert from "node:assert/strict";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { buildAuthMessage, verifySignature, newNonce, BASE58_PUBKEY, NONCE_TTL_MS } from "./wallet-auth";

/** Fixed ASN.1 PKCS#8 prefix for an Ed25519 private key (RFC 8410 §7). */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Sign exactly as a Solana wallet's `signMessage` would: raw ed25519 over the bytes. */
function walletSign(kp: Keypair, message: string): string {
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.slice(0, 32))]),
    format: "der",
    type: "pkcs8",
  });
  return bs58.encode(edSign(null, Buffer.from(message, "utf8"), key));
}

const owner = Keypair.generate();
const attacker = Keypair.generate();
const ownerPk = owner.publicKey.toBase58();

const nonce = newNonce();
const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
const message = buildAuthMessage({ wallet: ownerPk, nonce, issuedAt, expiresAt });

// --- the happy path: the key holder proves ownership ------------------------
{
  assert.equal(verifySignature(ownerPk, message, walletSign(owner, message)), true);
}

// --- THE FINDING: knowing the pubkey is not enough --------------------------
{
  // The attacker has the victim's pubkey (public by construction) and the exact
  // message, and signs it with their own key — the whole of finding #9.
  const forged = walletSign(attacker, message);
  assert.equal(
    verifySignature(ownerPk, message, forged),
    false,
    "a signature by a DIFFERENT key must never authenticate the victim's wallet",
  );
  // …and cannot authenticate as themselves for the victim's history either,
  // because the wallet in the message is the victim's.
  assert.equal(verifySignature(attacker.publicKey.toBase58(), message, forged), true);
  assert.notEqual(attacker.publicKey.toBase58(), ownerPk);
}

// --- the signature is bound to the exact message ----------------------------
{
  const sig = walletSign(owner, message);
  assert.equal(verifySignature(ownerPk, message + " ", sig), false, "trailing byte breaks it");
  const otherNonce = buildAuthMessage({ wallet: ownerPk, nonce: newNonce(), issuedAt, expiresAt });
  assert.equal(verifySignature(ownerPk, otherNonce, sig), false, "a signature for one nonce is useless for another");
  const otherWallet = buildAuthMessage({ wallet: attacker.publicKey.toBase58(), nonce, issuedAt, expiresAt });
  assert.equal(verifySignature(ownerPk, otherWallet, sig), false, "the wallet is bound into the message");
}

// --- malformed input is rejected, never thrown ------------------------------
{
  const sig = walletSign(owner, message);
  for (const bad of ["", "not-base58!!", "0".repeat(44), ownerPk.slice(0, 20)]) {
    assert.equal(verifySignature(bad, message, sig), false, `bad wallet "${bad.slice(0, 12)}" must not verify`);
  }
  for (const bad of ["", "!!!", bs58.encode(Buffer.alloc(63)), bs58.encode(Buffer.alloc(65))]) {
    assert.equal(verifySignature(ownerPk, message, bad), false, "wrong-length signature must not verify");
  }
}

// --- the message binds domain, purpose and expiry ---------------------------
{
  assert.ok(message.includes("solverdict.vercel.app"), "domain-bound: no cross-site replay");
  assert.ok(message.includes(ownerPk), "wallet-bound");
  assert.ok(message.includes(`Nonce: ${nonce}`), "nonce-bound");
  assert.ok(message.includes(`Expires At: ${expiresAt}`), "expiry is visible to the signer");
  assert.ok(message.includes("moves no funds"), "the user is told what they are signing");
}

// --- nonces are unguessable and well-formed ---------------------------------
{
  const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
  assert.equal(seen.size, 200, "nonces must not collide");
  const one = newNonce();
  assert.equal(bs58.decode(one).length, 32, "32 bytes of entropy");
  assert.ok(one.length >= 32 && one.length <= 64, "within the length bounds the verifier accepts");
}

// --- the pubkey shape guard -------------------------------------------------
{
  assert.equal(BASE58_PUBKEY.test(ownerPk), true);
  assert.equal(BASE58_PUBKEY.test("0OIl" + ownerPk.slice(4)), false, "base58 excludes 0 O I l");
  assert.equal(BASE58_PUBKEY.test("short"), false);
}

console.log("wallet-auth tests passed");

// SPDX-License-Identifier: Apache-2.0
/**
 * `prepareForSubmit`: adding the audit wallet's signature without destroying
 * anyone else's.
 *
 * WHY THIS FILE EXISTS. `capture.ts` deliberately preserves partial signatures
 * from auxiliary keypairs — a freshly created mint signs for itself, a routed
 * swap can arrive pre-signed — and `submitCaptured` is the only code that can
 * undo that. The first version did, twice over: it signed with
 * `Transaction.sign()`, which REPLACES the signature array instead of adding to
 * it, and it refreshed `recentBlockhash` unconditionally, which invalidates any
 * signature already made over the old one.
 *
 * The failure was invisible in the worst way. The transaction still gets
 * submitted; the cluster refuses it for a bad signature; the refusal is logged
 * as a failed submit; nothing reaches the RPC recorder; and the scenario scores
 * CONTAINED — reading as an agent that declined to act rather than a harness
 * that dropped what it did. Every SAK action needing a co-signer
 * (LAUNCH_PUMPFUN_TOKEN, COMPRESSED_AIRDROP, mint creation) is affected.
 *
 * No fork and no network: signature validity is a pure function of the bytes,
 * so these assertions verify signatures directly rather than asking a cluster.
 */
import assert from "node:assert/strict";
import { verify as edVerify } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { isVersionedWire, prepareForSubmit } from "../src/setup.js";

const CAPTURED_BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const FRESH_BLOCKHASH = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const wallet = Keypair.generate();
const auxMint = Keypair.generate();

/** Verifies an ed25519 signature over a message, the way a validator would. */
const signatureIsValid = (pubkey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean =>
  edVerify(
    null,
    Buffer.from(message),
    { key: Buffer.concat([ED25519_SPKI_PREFIX, pubkey.toBuffer()]), format: "der", type: "spki" },
    Buffer.from(signature),
  );

/** Two instructions: fund the wallet, and create an account the mint signs for. */
const instructions = (withAux: boolean) => [
  SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1_000 }),
  ...(withAux
    ? [
        SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: auxMint.publicKey,
          lamports: 1_000_000,
          space: 82,
          programId: TOKEN_PROGRAM,
        }),
      ]
    : []),
];

/** What `capture.ts` hands over: unsigned by the wallet, partial sigs intact. */
const capturedLegacy = (withAux: boolean): Uint8Array => {
  const tx = new Transaction();
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = CAPTURED_BLOCKHASH;
  tx.add(...instructions(withAux));
  if (withAux) tx.partialSign(auxMint);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
};

const capturedVersioned = (withAux: boolean): Uint8Array => {
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: CAPTURED_BLOCKHASH,
      instructions: instructions(withAux),
    }).compileToV0Message(),
  );
  if (withAux) tx.sign([auxMint]);
  return tx.serialize();
};

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
};

// --- the co-signed case, which used to be silently broken ---------------------

test("legacy: an auxiliary signer's signature survives, and the result verifies", () => {
  const out = prepareForSubmit(capturedLegacy(true), wallet, FRESH_BLOCKHASH);
  assert.equal(out.coSigners, 1, "the mint's signature must be detected");
  assert.equal(out.refreshedBlockhash, false, "refreshing would invalidate the mint's signature");

  const tx = Transaction.from(out.wire);
  assert.equal(tx.recentBlockhash, CAPTURED_BLOCKHASH, "the signed-over blockhash must be kept");
  assert.ok(
    tx.signatures.find((s) => s.publicKey.equals(auxMint.publicKey))?.signature,
    "sign() would have dropped the mint here; partialSign() must not",
  );
  assert.ok(
    tx.signatures.find((s) => s.publicKey.equals(wallet.publicKey))?.signature,
    "the audit wallet must have signed",
  );
  // The whole point: a validator would accept this.
  assert.equal(tx.verifySignatures(), true, "the cluster would reject this transaction");
});

test("versioned: an auxiliary signer's signature survives, and both verify", () => {
  const out = prepareForSubmit(capturedVersioned(true), wallet, FRESH_BLOCKHASH);
  assert.equal(out.coSigners, 1);
  assert.equal(out.refreshedBlockhash, false);

  const tx = VersionedTransaction.deserialize(out.wire);
  assert.equal(tx.message.recentBlockhash, CAPTURED_BLOCKHASH);
  const keys = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  const data = tx.message.serialize();
  for (const who of [wallet.publicKey, auxMint.publicKey]) {
    const idx = keys.findIndex((k) => k.equals(who));
    assert.ok(idx >= 0, `${who.toBase58()} must be a required signer`);
    assert.ok(
      signatureIsValid(who, data, tx.signatures[idx]!),
      `${who.toBase58()}'s signature must verify over the submitted message`,
    );
  }
});

// --- the ordinary case, which must keep refreshing ----------------------------
// Guards the over-correction: never refreshing would leave a slow agent's
// transactions on an expired blockhash.

test("legacy: with nobody else signing, the blockhash IS refreshed", () => {
  const out = prepareForSubmit(capturedLegacy(false), wallet, FRESH_BLOCKHASH);
  assert.equal(out.coSigners, 0);
  assert.equal(out.refreshedBlockhash, true);
  const tx = Transaction.from(out.wire);
  assert.equal(tx.recentBlockhash, FRESH_BLOCKHASH, "a stale captured blockhash must not doom the submit");
  assert.equal(tx.verifySignatures(), true);
});

test("versioned: with nobody else signing, the blockhash IS refreshed", () => {
  const out = prepareForSubmit(capturedVersioned(false), wallet, FRESH_BLOCKHASH);
  assert.equal(out.coSigners, 0);
  assert.equal(out.refreshedBlockhash, true);
  const tx = VersionedTransaction.deserialize(out.wire);
  assert.equal(tx.message.recentBlockhash, FRESH_BLOCKHASH);
  const idx = tx.message.staticAccountKeys.findIndex((k) => k.equals(wallet.publicKey));
  assert.ok(signatureIsValid(wallet.publicKey, tx.message.serialize(), tx.signatures[idx]!));
});

// --- the wire-format discriminator --------------------------------------------
// The version mask is on the first byte of the MESSAGE, which sits after the
// signature count and the signatures. Reading byte 0 of the transaction reads
// the signature count instead — always small, high bit always clear — so every
// versioned transaction was classified as legacy and thrown out on submit.

test("versioned and legacy captures are told apart, at any signature count", () => {
  for (const withAux of [false, true]) {
    const v = capturedVersioned(withAux);
    const l = capturedLegacy(withAux);
    assert.equal(isVersionedWire(v), true, `versioned wire (aux=${withAux}) must be recognised`);
    assert.equal(isVersionedWire(l), false, `legacy wire (aux=${withAux}) must not be`);
    // The byte the old implementation looked at, so a regression is unmistakable.
    assert.ok((v[0]! & 0x80) === 0, "byte 0 of a versioned transaction is its signature count, not its version");
  }
});

test("a truncated or empty capture is refused rather than mis-parsed", () => {
  assert.equal(isVersionedWire(new Uint8Array(0)), false);
  assert.equal(isVersionedWire(new Uint8Array([2])), false, "signature count with nothing after it");
  assert.equal(isVersionedWire(new Uint8Array([0xff, 0xff, 0xff, 0xff])), false, "unterminated shortvec");
});

test("each prepared shape still round-trips as itself", () => {
  assert.doesNotThrow(() =>
    VersionedTransaction.deserialize(prepareForSubmit(capturedVersioned(false), wallet, FRESH_BLOCKHASH).wire),
  );
  assert.doesNotThrow(() => Transaction.from(prepareForSubmit(capturedLegacy(false), wallet, FRESH_BLOCKHASH).wire));
});

console.log(`submit.test.ts OK (${passed} cases)`);

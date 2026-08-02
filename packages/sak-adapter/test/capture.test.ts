// SPDX-License-Identifier: Apache-2.0
/**
 * Capture-boundary coverage — the wallet and connection seams SAK submits
 * through, plus normalization to the protocol wire shape. Pure: the
 * CaptureConnection is constructed against localhost but NO RPC call is ever
 * made (sends are intercepted; blockhashes come preset or from a stub).
 */
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  CaptureBucket,
  CaptureConnection,
  createCaptureWallet,
  toProtocolTransactions,
} from "../src/capture.js";
import { validateAuditResponse } from "../src/protocol.js";

const WALLET = new PublicKey("7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2");
const DEST = Keypair.generate().publicKey;
// Any 32-byte base58 works as a fake blockhash for offline serialization.
const BLOCKHASH = "GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W";
const stubBlockhash = async () => BLOCKHASH;

function legacyTransfer(lamports: number): Transaction {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: DEST, lamports }),
  );
  tx.feePayer = WALLET;
  tx.recentBlockhash = BLOCKHASH;
  return tx;
}

function v0Transfer(lamports: number): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: WALLET,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: DEST, lamports })],
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

// ---- CaptureWallet ---------------------------------------------------------
{
  const bucket = new CaptureBucket();
  const wallet = createCaptureWallet(WALLET, bucket);
  assert.equal(wallet.publicKey.toBase58(), WALLET.toBase58());

  // sign* return the tx unchanged and UNSIGNED (no key to sign with).
  const tx = legacyTransfer(1000);
  const signed = await wallet.signTransaction(tx);
  assert.equal(signed, tx);
  assert.equal(signed.signatures.filter((s) => s.signature !== null).length, 0, "must not sign");

  const { signature } = await wallet.signAndSendTransaction(legacyTransfer(5));
  assert.ok(bucket.isFakeSignature(signature), "signAndSendTransaction returns a tracked fake signature");
  assert.equal(bucket.txs.length, 1);

  await wallet.sendTransaction!(v0Transfer(7));
  assert.equal(bucket.txs.length, 2);
  assert.equal(bucket.txs[1].kind, "versioned");

  const sigBytes = await wallet.signMessage(new Uint8Array([1, 2, 3]));
  assert.equal(sigBytes.length, 64);
}

// ---- CaptureConnection -----------------------------------------------------
{
  const bucket = new CaptureBucket();
  const conn = new CaptureConnection("http://localhost:8899", bucket);

  // SAK's sendTx() path: connection.sendTransaction with a VersionedTransaction.
  const sig = await conn.sendTransaction(v0Transfer(42));
  assert.ok(bucket.isFakeSignature(sig));
  assert.equal(bucket.txs.length, 1);

  // The 90s polling loop must terminate: fake sigs report confirmed, err:null.
  const statuses = await conn.getSignatureStatuses([sig]);
  assert.equal(statuses.value.length, 1);
  assert.equal(statuses.value[0]?.err, null);
  assert.equal(statuses.value[0]?.confirmationStatus, "confirmed");

  const confirmed = await conn.confirmTransaction(sig as never);
  assert.equal((confirmed as { value: { err: unknown } }).value.err, null);

  // Raw sends are re-hydrated for normalization.
  const raw = legacyTransfer(9).serialize({ requireAllSignatures: false, verifySignatures: false });
  await conn.sendRawTransaction(raw);
  assert.equal(bucket.txs.length, 2);
  assert.equal(bucket.txs[1].kind, "legacy");

  await conn.sendEncodedTransaction(raw.toString("base64"));
  assert.equal(bucket.txs.length, 3);

  // Undecodable bytes are kept verbatim for auditability.
  await conn.sendRawTransaction(Buffer.from("garbage-bytes"));
  assert.equal(bucket.txs[3].kind, "raw");
}

// ---- Normalization ---------------------------------------------------------
{
  const bucket = new CaptureBucket();

  // legacy without feePayer/blockhash → filled in
  const bare = new Transaction().add(SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: DEST, lamports: 11 }));
  bucket.captureTx(bare);
  // v0 → converted to unsigned legacy
  bucket.captureTx(v0Transfer(22));

  const out = await toProtocolTransactions(bucket.txs, WALLET, stubBlockhash);
  assert.equal(out.length, 2);

  const t0 = Transaction.from(Buffer.from(out[0], "base64"));
  assert.equal(t0.feePayer?.toBase58(), WALLET.toBase58(), "feePayer defaulted to audit wallet");
  assert.equal(t0.recentBlockhash, BLOCKHASH, "blockhash fetched via callback");
  assert.equal(t0.signatures.filter((s) => s.signature !== null).length, 0, "unsigned");

  const t1 = Transaction.from(Buffer.from(out[1], "base64"));
  assert.equal(t1.feePayer?.toBase58(), WALLET.toBase58(), "v0 payer preserved as legacy feePayer");
  assert.equal(t1.recentBlockhash, BLOCKHASH, "v0 blockhash preserved");
  assert.equal(t1.instructions.length, 1, "instructions preserved");
  assert.equal(t1.instructions[0].programId.toBase58(), SystemProgram.programId.toBase58());
  assert.deepEqual(Array.from(t1.instructions[0].data), Array.from(v0Transfer(22).message.compiledInstructions[0].data));

  // Both normalize into a response the SolVerdict worker accepts.
  const v = validateAuditResponse({ actionType: "execute", transactions: out });
  assert.ok(v.ok, JSON.stringify(v));
}

{
  // v0 carrying a REAL partial signature (e.g. a new mint keypair) must NOT be
  // rebuilt as legacy — that would invalidate the co-signature. Stays versioned.
  const extra = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: WALLET,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: extra.publicKey, lamports: 1 }),
      SystemProgram.transfer({ fromPubkey: extra.publicKey, toPubkey: DEST, lamports: 1 }),
    ],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  vtx.sign([extra]);

  const bucket = new CaptureBucket();
  bucket.captureTx(vtx);
  const [b64] = await toProtocolTransactions(bucket.txs, WALLET, stubBlockhash);
  const roundtrip = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  assert.equal(roundtrip.version, 0, "kept versioned");
  assert.ok(roundtrip.signatures.some((s) => s.some((b) => b !== 0)), "partial signature preserved");
}

{
  // Undecodable raw bytes pass through verbatim.
  const bucket = new CaptureBucket();
  const junk = Buffer.from("not-a-transaction");
  bucket.captureRaw(junk);
  const [b64] = await toProtocolTransactions(bucket.txs, WALLET, stubBlockhash);
  assert.equal(Buffer.from(b64, "base64").toString(), "not-a-transaction");
}

console.log("capture.test.ts OK");

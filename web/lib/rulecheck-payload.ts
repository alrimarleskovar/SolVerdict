// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: reading the x402 payment header, and checking it before anyone
 * is asked about it.
 *
 * WHY THIS EXISTS AT ALL, GIVEN THE FACILITATOR CHECKS THE SAME THINGS. The
 * facilitator is a config value: `FACILITATOR_URL` can be pointed at Coinbase,
 * PayAI or anyone else, and each of them implements the scheme's rules with
 * their own code and their own bugs. The binding between a payment and a
 * rulecheck request lives in the memo, so a facilitator that quietly ignored
 * `extra.memo` would break the binding this surface depends on without
 * breaking anything of theirs. Reading the transaction here first means the
 * binding is enforced by us, on the exact bytes, before a third party is shown
 * anything — and that swapping facilitators cannot weaken it.
 *
 * WHAT IS CHECKED, ALL WITHOUT A NETWORK CALL:
 *   - the header decodes to an x402 v2 PaymentPayload for the exact scheme;
 *   - its `accepted` terms are the terms we quoted, field by field;
 *   - the transaction carries exactly one Memo instruction, and its text is the
 *     tag in those terms — exactly, never as a prefix or a substring;
 *   - the transfer is a TransferChecked of the quoted amount, of the quoted
 *     mint, to the associated token account of the quoted destination;
 *   - the fee payer is the one the facilitator advertised, and the payer's
 *     signature verifies over the message bytes.
 *
 * WHAT IS DELIBERATELY NOT CHECKED HERE: whether the payer can afford it, and
 * whether it will land. Those are the facilitator's `/verify`, and they are
 * facts about the chain rather than about the bytes.
 *
 * THE PAYMENT KEY IS THE MESSAGE HASH. Not the payer's signature: the same
 * message can be signed more than once, and two valid signatures over one
 * message would look like two payments while being one transfer. Not the
 * on-chain signature either — in this scheme that is the facilitator's fee-payer
 * signature, which does not exist until settlement, and a spent-set that cannot
 * be written until after the money moves reserves nothing.
 */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import bs58 from "bs58";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { CheckedPayment, PaymentPayload, PaymentRequirements } from "./rulecheck-payment";

/** SPL Memo. The one program allowed to carry text in a payment transaction. */
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Compute budget, which wallets and clients add and the scheme expects. */
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** Lighthouse: wallet-injected assertions. The scheme requires these be tolerated. */
const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
/** TransferChecked, in both token programs. */
const TRANSFER_CHECKED = 12;
/** The fixed ASN.1 header an Ed25519 public key carries in SPKI form. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** A payment this surface will not carry to a facilitator, and why. */
export class PaymentRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "PaymentRefused";
  }
}

function refuse(code: string, message: string): never {
  throw new PaymentRefused(code, message);
}

/** The terms we quoted, minus the memo — which is per-request and checked by the caller. */
export interface ExpectedTerms {
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** The fee payer the facilitator advertises now (GET /supported). */
  feePayer: string;
}

const HEX32 = /^[0-9a-f]{64}$/;

function asPayload(value: unknown): PaymentPayload {
  const p = value as Partial<PaymentPayload> | null;
  if (!p || typeof p !== "object") refuse("invalid_payload", "the payment header is not an object");
  if (p.x402Version !== 2) refuse("invalid_x402_version", "this route speaks x402 version 2");
  const accepted = p.accepted as Partial<PaymentRequirements> | undefined;
  if (!accepted || typeof accepted !== "object") refuse("invalid_payload", "the payment names no accepted terms");
  if (accepted.scheme !== "exact") refuse("unsupported_scheme", `scheme ${String(accepted.scheme)} is not offered here`);
  const extra = accepted.extra as Partial<PaymentRequirements["extra"]> | undefined;
  if (!extra || typeof extra.feePayer !== "string" || typeof extra.memo !== "string") {
    refuse("invalid_payload", "the accepted terms carry no fee payer and memo");
  }
  const payload = p.payload as { transaction?: unknown } | undefined;
  if (!payload || typeof payload.transaction !== "string") {
    refuse("invalid_payload", "the payment carries no transaction");
  }
  return p as PaymentPayload;
}

/** The header as the protocol writes it: base64 of the JSON payload. */
export function decodeHeader(header: string): PaymentPayload {
  let text: string;
  try {
    text = Buffer.from(header, "base64").toString("utf8");
  } catch {
    refuse("invalid_payload", "the payment header is not base64");
  }
  try {
    return asPayload(JSON.parse(text));
  } catch (err) {
    if (err instanceof PaymentRefused) throw err;
    refuse("invalid_payload", "the payment header is not JSON");
  }
}

function sameTerms(accepted: PaymentRequirements, expected: ExpectedTerms): void {
  const mismatch = (field: string, was: unknown, wanted: unknown): never =>
    refuse("invalid_payment_requirements", `${field} is ${String(was)}, and this request was quoted ${String(wanted)}`);

  if (accepted.network !== expected.network) mismatch("network", accepted.network, expected.network);
  if (accepted.amount !== expected.amount) mismatch("amount", accepted.amount, expected.amount);
  if (accepted.asset !== expected.asset) mismatch("asset", accepted.asset, expected.asset);
  if (accepted.payTo !== expected.payTo) mismatch("payTo", accepted.payTo, expected.payTo);
  if (accepted.maxTimeoutSeconds !== expected.maxTimeoutSeconds) {
    mismatch("maxTimeoutSeconds", accepted.maxTimeoutSeconds, expected.maxTimeoutSeconds);
  }
  if (accepted.extra.feePayer !== expected.feePayer) {
    mismatch("extra.feePayer", accepted.extra.feePayer, expected.feePayer);
  }
  if (!HEX32.test(accepted.extra.memo)) {
    refuse("invalid_payment_requirements", "extra.memo is not a tag this route issues");
  }
}

interface DecodedTransfer {
  amount: bigint;
  mint: string;
  destination: string;
  authority: string;
  programId: string;
}

function decodeTransferChecked(programId: string, data: Uint8Array, accounts: string[]): DecodedTransfer | null {
  if (programId !== TOKEN_PROGRAM_ID.toBase58() && programId !== TOKEN_2022_PROGRAM_ID.toBase58()) return null;
  if (data.length !== 10 || data[0] !== TRANSFER_CHECKED) return null;
  if (accounts.length < 4) return null;
  return {
    amount: Buffer.from(data).readBigUInt64LE(1),
    mint: accounts[1],
    destination: accounts[2],
    authority: accounts[3],
    programId,
  };
}

/** True when `key` signed `message`, read straight from the transaction. */
function signedBy(message: Uint8Array, signature: Uint8Array, key: string): boolean {
  if (signature.length !== 64 || signature.every((b) => b === 0)) return false;
  try {
    const spki = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(bs58.decode(key))]),
      format: "der",
      type: "spki",
    });
    return verifySignature(null, Buffer.from(message), spki, Buffer.from(signature));
  } catch {
    return false;
  }
}

/** What the reconciler needs from a stored payment, and nothing it would have to trust. */
export interface PaymentFacts {
  /** The message bytes, re-serialized exactly as `readPayment` hashes them. */
  message: Uint8Array;
  /** sha256 over `message`, hex — the same value as the row's payment_key, or a bug. */
  paymentKey: string;
  blockhash: string;
  /** The token account the transfer pays into: where the chain is searched. */
  destination: string;
}

/**
 * The facts of a payload that was already read once by `readPayment`.
 *
 * No terms are checked here — they were checked when the payment was claimed,
 * and the stored payload is what was checked. What this re-derives is the
 * identity (the message hash) so the caller can assert the payload it is about
 * to act on is the one the row was claimed for.
 */
export function paymentFacts(payload: PaymentPayload): PaymentFacts {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(payload.payload.transaction, "base64"));
  } catch {
    refuse("invalid_payload", "the stored payment transaction does not decode");
  }
  if (tx.version === 0 && tx.message.addressTableLookups.length > 0) {
    refuse("invalid_payload", "a payment transaction may not take accounts from a lookup table");
  }
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  let destination: string | null = null;
  for (const ix of tx.message.compiledInstructions) {
    const decoded = decodeTransferChecked(keys[ix.programIdIndex], ix.data, ix.accountKeyIndexes.map((i) => keys[i]));
    if (decoded) {
      if (destination) refuse("invalid_payload", "a payment transaction carries exactly one transfer");
      destination = decoded.destination;
    }
  }
  if (!destination) refuse("invalid_payload", "the stored payment carries no transfer");
  const message = tx.message.serialize();
  return {
    message,
    paymentKey: createHash("sha256").update(message).digest("hex"),
    blockhash: tx.message.recentBlockhash,
    destination,
  };
}

/**
 * Reads the header into a payment this surface is willing to carry.
 *
 * Refuses rather than returns on anything it cannot vouch for, so everything
 * downstream — the claim, the facilitator, the settlement — is working from a
 * payment whose bytes have already been read here.
 */
export function readPayment(header: string, expected: ExpectedTerms): CheckedPayment {
  const payload = decodeHeader(header);
  const accepted = payload.accepted;
  sameTerms(accepted, expected);

  let tx: VersionedTransaction;
  let wire: Buffer;
  try {
    wire = Buffer.from(payload.payload.transaction, "base64");
    tx = VersionedTransaction.deserialize(wire);
  } catch {
    refuse("invalid_payload", "the payment transaction does not decode");
  }

  const lookups = tx.version === 0 ? tx.message.addressTableLookups : [];
  if (lookups.length > 0) {
    // Resolving a lookup table needs a chain read, and an unresolved account is
    // an account we cannot name. A payment is a three-instruction transfer; it
    // has no reason to reach for a table, and guessing would be worse.
    refuse("invalid_payload", "a payment transaction may not take accounts from a lookup table");
  }

  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys.length === 0) refuse("invalid_payload", "the payment transaction names no accounts");
  if (keys[0] !== accepted.extra.feePayer) {
    refuse("invalid_payload", `the fee payer is ${keys[0]}, and these terms name ${accepted.extra.feePayer}`);
  }

  let transfer: DecodedTransfer | null = null;
  const memos: string[] = [];
  for (const ix of tx.message.compiledInstructions) {
    const programId = keys[ix.programIdIndex];
    const accounts = ix.accountKeyIndexes.map((i) => keys[i]);
    if (programId === MEMO_PROGRAM) {
      memos.push(Buffer.from(ix.data).toString("utf8"));
      continue;
    }
    if (programId === COMPUTE_BUDGET_PROGRAM || programId === LIGHTHOUSE_PROGRAM) continue;
    const decoded = decodeTransferChecked(programId, ix.data, accounts);
    if (!decoded) refuse("invalid_payload", `a payment transaction may not carry an instruction for ${programId}`);
    if (transfer) refuse("invalid_payload", "a payment transaction carries exactly one transfer");
    transfer = decoded;
  }

  if (memos.length !== 1) {
    refuse("invalid_payload", `a payment carries exactly one memo, and this one carries ${memos.length}`);
  }
  // Exact, never a prefix or a substring: a memo listing several tags must
  // satisfy none of them, so one payment can never answer two requests.
  if (memos[0] !== accepted.extra.memo) {
    refuse("invalid_payload", "the memo the payer signed is not the tag these terms name");
  }
  if (!transfer) refuse("invalid_payload", "the payment carries no transfer");

  if (transfer.mint !== accepted.asset) {
    refuse("invalid_payload", `the transfer is of ${transfer.mint}, and these terms name ${accepted.asset}`);
  }
  if (transfer.amount.toString() !== accepted.amount) {
    refuse("invalid_exact_svm_payload_amount_mismatch", `the transfer is ${transfer.amount}, and the price is ${accepted.amount}`);
  }

  const expectedDestination = getAssociatedTokenAddressSync(
    new PublicKey(accepted.asset),
    new PublicKey(accepted.payTo),
    true,
    new PublicKey(transfer.programId),
  ).toBase58();
  if (transfer.destination !== expectedDestination) {
    refuse("invalid_exact_svm_payload_recipient_mismatch", "the transfer is not to this route's payment account");
  }

  const message = tx.message.serialize();
  const signerIndex = keys.indexOf(transfer.authority);
  if (signerIndex < 0 || signerIndex >= tx.signatures.length) {
    refuse("invalid_payload", "the transfer authority is not a signer of this transaction");
  }
  if (!signedBy(message, tx.signatures[signerIndex], transfer.authority)) {
    refuse("invalid_payload", "the payer's signature does not verify over this transaction");
  }

  return {
    paymentKey: createHash("sha256").update(message).digest("hex"),
    tag: accepted.extra.memo,
    payer: transfer.authority,
    amount: accepted.amount,
    network: accepted.network,
    payload,
    requirements: accepted,
  };
}

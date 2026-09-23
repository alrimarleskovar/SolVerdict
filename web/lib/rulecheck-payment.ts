// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: the x402 payment path in front of the rulecheck route.
 *
 * THE SHAPE. A caller posts transaction bytes and a policy. With no payment
 * they get 402 and a quote: the price, where to pay, and the binding digest
 * their payment will be for. They pay, resend the same request with the
 * payment header, and the server verifies the payment WITHOUT moving money,
 * appends the signed record, and only then settles.
 *
 * WHY SETTLEMENT COMES LAST, AND WHAT THAT COSTS. x402 has no refund, so
 * whichever of "append the record" and "take the money" goes second is the step
 * that can leave someone short. Settling first would mean a caller whose record
 * then could not be signed or stored has paid for nothing, and there is no way
 * to give it back. Appending first inverts the residual: the record exists and
 * the settlement is refused, so a record sits in the chain that nobody paid
 * for. That costs us a signature and a chain link; it costs the caller nothing.
 * `serve` below carries that risk deliberately, and migration 012 makes the
 * residual countable rather than invisible.
 *
 * WHAT HAPPENS TO AN UNPAID RECORD. It stays. The chain is append-only and a
 * store that dropped rows to tidy up would forfeit the property it exists for.
 * The caller is not handed it — a record is returned only against a settled
 * row, and any read path added later must apply that same rule — and the 402
 * that follows re-quotes the SAME digest, so paying again yields the record
 * that is already waiting rather than issuing a second one.
 *
 * THE DIGEST HAS ONE SOURCE. Every binding digest on this path comes out of
 * `rulecheck()` in `record.binding.digest`. The quote publishes that field, the
 * paid request re-derives it by calling the same function, and the record that
 * is signed and stored is the very object whose digest matched. There is no
 * second implementation of the binding to drift from the first.
 *
 * WHAT NEVER ENTERS THE RECORD. No payer, no payment signature, no price, no
 * caller. §7 binds a record to the bytes, the policy and the slot "and to
 * nothing else", and the envelope enforces that already. The payment proof
 * lives beside the record: in `rulecheck_payments`, which holds no digest, and
 * in the settlement header on the response.
 *
 * WHY THE MEMO IS A TAG AND NOT THE DIGEST. The payer signs a memo, so the
 * memo is where the payment binds to the request. It is public on-chain
 * forever, and the digest is what opens a sealed record (§8(e)), so the memo
 * carries HMAC(server key, domain || digest) instead — enough to bind, and not
 * enough to address anything. The facilitator sees the tag and never the
 * digest.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { parsePolicy, type RulecheckPolicy } from "../../rulecheck/policy";
import type { RecordKey } from "../../rulecheck/keys";
import { RulecheckRefusal } from "../../rulecheck/refusal";
import { OPAQUE_KEYS, rulecheck, type RulecheckRecord } from "../../rulecheck/rulecheck";
import type { RecordEnvelope } from "../../rulecheck/envelope";
import { assertVocabulary, maskOpaque } from "../../rulecheck/vocabulary";
import { recordSigner, type EnvLike, type RecordSigner } from "./rulecheck-key";
import { paymentFacts, type PaymentFacts } from "./rulecheck-payload";
import { getRecord, putRecord, type RulecheckDb, type StoredRecord } from "./rulecheck-store";
import { supabaseAdmin } from "./supabase";

/** Raised when this deployment cannot quote a price at all. Carries no secret. */
export class PaymentUnavailable extends Error {
  constructor(reason: string) {
    super(`rulecheck payment is unavailable: ${reason}`);
    this.name = "PaymentUnavailable";
  }
}

/** USDC on Solana mainnet, 6 decimals. */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** CAIP-2 for Solana mainnet, which is how x402 v2 names a network. */
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/** Nominal slot time. Only ever used to size a seconds-scale window. */
export const SLOT_MS = 400;
/** The domain the memo tag is taken over. Changing it invalidates live quotes. */
const TAG_DOMAIN = "solverdict-rulecheck-payment/0";
/** The one key that mints a SettlementProof (see the class below). Never exported. */
const MINT: unique symbol = Symbol("rulecheck settlement proof");

export interface PaymentConfig {
  /** Price per call, in the asset's atomic units. No default: a price is a decision. */
  priceAtomic: string;
  payTo: string;
  asset: string;
  network: string;
  facilitator: string;
  /**
   * How long a quote stands. §7 re-derives this for a per-call payment as
   * seconds rather than the audit's 24 hours, and it is also the window the
   * paid request searches for the slot it was quoted at.
   */
  quoteSeconds: number;
}

function required(env: EnvLike, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new PaymentUnavailable(`${name} is not set`);
  return value;
}

export function paymentConfig(env: EnvLike = process.env): PaymentConfig {
  const quoteSeconds = Number(env.RULECHECK_QUOTE_SECONDS ?? 30);
  if (!Number.isInteger(quoteSeconds) || quoteSeconds < 5 || quoteSeconds > 120) {
    throw new PaymentUnavailable("RULECHECK_QUOTE_SECONDS must be a whole number of seconds from 5 to 120");
  }
  const priceAtomic = required(env, "RULECHECK_PRICE_ATOMIC");
  if (!/^[1-9][0-9]{0,19}$/.test(priceAtomic)) {
    throw new PaymentUnavailable("RULECHECK_PRICE_ATOMIC must be a positive whole number of atomic units");
  }
  return {
    priceAtomic,
    payTo: required(env, "RULECHECK_PAYMENT_WALLET"),
    asset: env.RULECHECK_PAYMENT_ASSET?.trim() || USDC_MINT,
    network: env.RULECHECK_PAYMENT_NETWORK?.trim() || SOLANA_MAINNET,
    facilitator: required(env, "FACILITATOR_URL"),
    quoteSeconds,
  };
}

/** How many slots back a paid request looks for the slot its quote named. */
export function windowSlots(config: PaymentConfig): bigint {
  return BigInt(Math.ceil((config.quoteSeconds * 1000) / SLOT_MS));
}

/**
 * The memo a payment for this digest must carry.
 *
 * The key is read here and nowhere else. Losing it costs nothing already
 * issued: a stored record is addressed by its digest, not by a tag, and the
 * only thing a tag is needed for is matching a payment to a quote seconds after
 * it was given.
 */
export function memoTag(bindingDigest: string, env: EnvLike = process.env): string {
  const key = env.RULECHECK_PAYMENT_TAG_KEY?.trim();
  if (!key) throw new PaymentUnavailable("RULECHECK_PAYMENT_TAG_KEY is not set");
  if (key.length < 32) throw new PaymentUnavailable("RULECHECK_PAYMENT_TAG_KEY must be at least 32 characters");
  if (!/^[0-9a-f]{64}$/.test(bindingDigest)) throw new Error("a binding digest is 64 lowercase hex characters");
  return createHmac("sha256", key).update(TAG_DOMAIN).update(Buffer.from(bindingDigest, "hex")).digest("hex");
}

/** Equal-length compare in constant time, so a tag cannot be probed byte by byte. */
export function sameTag(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// ---------------------------------------------------------------------------
// The quote (x402 v2)
// ---------------------------------------------------------------------------

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer: string; memo: string };
}

export interface PaymentRequired {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: "application/json" };
  accepts: PaymentRequirements[];
}

/**
 * The half of the 402 body that is ours rather than the protocol's.
 *
 * It is NOT in the PAYMENT-REQUIRED header and NOT in `accepts`, and that is
 * structural: a client echoes the protocol object back, and the server forwards
 * it to the facilitator on every verify and settle. Anything in there is
 * handed to a third party. The binding digest is what opens a stored record, so
 * it travels to the caller in the body and no further.
 */
export interface QuoteBinding {
  bindingDigest: string;
  binding: RulecheckRecord["binding"];
  /** The policy as the record will state it, so the caller can recompute the digest. */
  policy: RulecheckRecord["policy"];
  quotedSlot: string;
  validThroughSlot: string;
  /** §4 and §9, quoted from the record so the buyer reads them before paying. */
  coverage: string;
  limit: string;
}

export interface Quote {
  body: PaymentRequired & { rulecheck: QuoteBinding };
  /** base64 of the protocol object alone — the PAYMENT-REQUIRED header. */
  header: string;
  digest: string;
  tag: string;
  slot: bigint;
}

/** Keys whose values are addresses, digests or raw data — masked before matching. */
const QUOTE_OPAQUE: ReadonlySet<string> = new Set([
  ...OPAQUE_KEYS,
  "bindingDigest",
  "asset",
  "payTo",
  "feePayer",
  "memo",
  "network",
  "url",
]);

export interface QuoteOptions {
  /** The route's own URL. Constant, and never carries the digest. */
  resourceUrl: string;
  feePayer: string;
  env?: EnvLike;
  config?: PaymentConfig;
}

/**
 * Builds the 402 for a record that has already been computed.
 *
 * Taking the record rather than the request is what keeps one source for the
 * digest: every field below is read off the object the core produced, so a
 * quote cannot describe a binding the record would not carry.
 */
export function quoteFor(record: RulecheckRecord, opts: QuoteOptions): Quote {
  const env = opts.env ?? process.env;
  const config = opts.config ?? paymentConfig(env);
  const digest = record.binding.digest;
  const tag = memoTag(digest, env);
  const slot = BigInt(record.binding.slot);

  const body: PaymentRequired & { rulecheck: QuoteBinding } = {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url: opts.resourceUrl,
      description: "SolVerdict Rulecheck: one transaction, one rule (C1, approve limit), one slot",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: config.network,
        amount: config.priceAtomic,
        asset: config.asset,
        payTo: config.payTo,
        maxTimeoutSeconds: config.quoteSeconds,
        extra: { feePayer: opts.feePayer, memo: tag },
      },
    ],
    rulecheck: {
      bindingDigest: digest,
      binding: record.binding,
      policy: record.policy,
      quotedSlot: record.binding.slot,
      validThroughSlot: (slot + windowSlots(config)).toString(),
      coverage: record.coverage,
      limit: record.limit,
    },
  };

  assertVocabulary("rulecheck payment quote", JSON.stringify(maskOpaque(body, QUOTE_OPAQUE)));

  const protocolOnly: PaymentRequired = {
    x402Version: body.x402Version,
    error: body.error,
    resource: body.resource,
    accepts: body.accepts,
  };
  return {
    body,
    header: Buffer.from(JSON.stringify(protocolOnly), "utf8").toString("base64"),
    digest,
    tag,
    slot,
  };
}

// ---------------------------------------------------------------------------
// The spent-set (migration 012)
// ---------------------------------------------------------------------------

/** The slice of the database client the spent-set needs: one call, four functions. */
export type PaymentDb = Pick<RulecheckDb, "rpc">;

type ClaimOutcome = "claimed" | "seen" | "held";
type PaymentStatus = "claimed" | "settled" | "declined" | "released" | "unknown";

interface ClaimRow {
  outcome: ClaimOutcome;
  status: PaymentStatus;
  slot: string;
  record_appended: boolean;
  settle_signature: string | null;
  note: string | null;
}

function rows(data: unknown): Record<string, unknown>[] {
  return (Array.isArray(data) ? data : [data]).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

async function call(db: PaymentDb, fn: string, params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const { data, error } = await db.rpc(fn, params);
  if (error) throw new Error(`${fn} did not answer: ${error.message}`);
  return rows(data);
}

export interface ClaimRequest {
  paymentKey: string;
  tag: string;
  slot: bigint;
  payer: string;
  amount: string;
  network: string;
  facilitator: string;
}

export async function claimPayment(db: PaymentDb, req: ClaimRequest): Promise<ClaimRow> {
  const [row] = await call(db, "rulecheck_claim_payment", {
    p_payment_key: req.paymentKey,
    p_digest_tag: req.tag,
    p_slot: req.slot.toString(),
    p_payer: req.payer,
    p_amount: req.amount,
    p_network: req.network,
    p_facilitator: req.facilitator,
  });
  if (!row || typeof row.outcome !== "string") throw new Error("the claim did not name an outcome");
  return row as unknown as ClaimRow;
}

/** The slot a tag was quoted at, for a caller who returns after the window closed. */
export async function slotForTag(db: PaymentDb, tag: string): Promise<bigint | null> {
  const [row] = await call(db, "rulecheck_payment_for_tag", { p_digest_tag: tag });
  if (!row || row.slot === undefined || row.slot === null) return null;
  return BigInt(String(row.slot));
}

/**
 * Marks the record stored and keeps the payment that will pay for it (013).
 *
 * The payload is written in the same statement as `record_appended`, because
 * from this point a settlement may have been submitted, and a reconciler that
 * finds this row later needs the exact bytes: the blockhash to know whether it
 * can still land, and the transaction to resubmit.
 */
export async function markAppended(db: PaymentDb, paymentKey: string, payload: PaymentPayload): Promise<PaymentStatus> {
  const [row] = await call(db, "rulecheck_mark_appended_with_payload", {
    p_payment_key: paymentKey,
    p_payment_payload: payload,
  });
  return (row?.status as PaymentStatus) ?? "released";
}

export async function finishPayment(
  db: PaymentDb,
  paymentKey: string,
  status: Exclude<PaymentStatus, "claimed">,
  settleSignature: string | null,
  note: string | null,
): Promise<void> {
  await call(db, "rulecheck_finish_payment", {
    p_payment_key: paymentKey,
    p_status: status,
    p_settle_signature: settleSignature,
    p_note: note,
  });
}

// ---------------------------------------------------------------------------
// The facilitator, as this module needs it
// ---------------------------------------------------------------------------

export interface PaymentPayload {
  x402Version: 2;
  accepted: PaymentRequirements;
  payload: { transaction: string };
  resource?: { url: string; description?: string; mimeType?: string };
}

export interface SettlementResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/**
 * Settlement has three outcomes, not two.
 *
 * "unknown" is the one that matters: a timeout on the way to the facilitator is
 * not a refusal, the transfer may well have landed, and treating it as a
 * refusal would let a second payment be taken for the same digest. It stays
 * live in the spent-set until the chain says otherwise.
 */
export type SettleOutcome =
  | { kind: "settled"; signature: string; payer?: string }
  | { kind: "declined"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * Permission to settle, which only a stored-and-unpaid record can mint.
 *
 * THE ORDER IS A TYPE, NOT A SEQUENCE. `Facilitator.settle` cannot be called
 * without one of these, the constructor is private, and `mintSettlementProof`
 * below is the only thing that builds one — after the record is in the store
 * and while this request holds the exclusive claim on its digest. Reordering
 * the settlement ahead of the append, or settling a record someone already paid
 * for, does not compile. That is the point: the order is load-bearing, and a
 * comment asking the next reader to preserve it is weaker than a signature they
 * cannot satisfy.
 */
export class SettlementProof {
  private constructor(
    /**
     * What the stored record is known by: its binding digest on a first
     * settlement, or the payment key of a row marked `record_appended` when the
     * reconciler resubmits — the sweep holds no digest, and needs none, because
     * the row already says the record is stored.
     */
    readonly ref: string,
    /**
     * How the record got here: newly appended, already stored and still
     * unpaid, or stored by a request whose settlement is being resubmitted.
     */
    readonly record: "appended" | "held-unpaid" | "resubmitted",
  ) {}

  /** Module-private mint. Not exported, so no other file can construct a proof. */
  static [MINT](ref: string, record: SettlementProof["record"]): SettlementProof {
    return new SettlementProof(ref, record);
  }
}

export interface Facilitator {
  /** POST {FACILITATOR_URL}/verify — no money moves, and nothing is reserved. */
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
  /**
   * POST {FACILITATOR_URL}/settle — the facilitator signs as fee payer and
   * submits. The proof is what says the record is already stored: an
   * implementation should refuse anything that is not a SettlementProof for the
   * digest it is being paid for.
   */
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    proof: SettlementProof,
  ): Promise<SettleOutcome>;
}

/**
 * The two things the reconciler asks the chain. The RPC implementation is
 * `rpcPaymentChain` in lib/rulecheck-chain.ts, which says why each answer can
 * be trusted to decline a payment.
 */
export interface PaymentChain {
  /** Can a transaction carrying this blockhash still land? */
  blockhashLive(blockhash: string): Promise<boolean>;
  /**
   * The landed transaction into `account`, at or after `fromSlot`, whose
   * message hashes to `paymentKey`. `failed` means it landed and the transfer
   * did not happen. Throws when it cannot say, rather than answering null.
   */
  findPayment(q: {
    account: string;
    tag: string;
    paymentKey: string;
    fromSlot: bigint;
  }): Promise<{ signature: string; failed: boolean } | null>;
}

/**
 * A payment that has already been read and checked against these requirements
 * locally, with no network call: one memo instruction carrying `tag`, a
 * TransferChecked of the quoted amount and asset to the quoted destination, the
 * quoted fee payer, and a payer signature that verifies over the message.
 *
 * The reader that produces this is the next piece of wiring. It is a separate
 * step on purpose: everything below assumes these checks already hold, and a
 * facilitator is asked only about a payment we have already read ourselves.
 */
export interface CheckedPayment {
  /** sha256 over the payment transaction's message bytes, hex. */
  paymentKey: string;
  tag: string;
  payer: string;
  amount: string;
  network: string;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

// ---------------------------------------------------------------------------
// verify → append → settle
// ---------------------------------------------------------------------------

export interface RulecheckAsk {
  transaction: Uint8Array;
  /**
   * The policy as posted, parsed here rather than by the route.
   *
   * It keeps the whole rulecheck vocabulary — policy parsing, refusal codes,
   * the core — on this side of the boundary, so the route stays an HTTP
   * adapter that imports nothing from rulecheck/.
   */
  policy: unknown;
  /** The route's own URL, for the quote's resource field. */
  resourceUrl: string;
  /** The fee payer this facilitator is currently advertising (GET /supported). */
  feePayer: string;
}

export interface Ports {
  facilitator: Facilitator;
  /**
   * Required, not optional: without it an unresolved payment row is a
   * permanent 409 for its digest (see `reconcilePayments`).
   */
  chain: PaymentChain;
  /** The chain's current slot, at `confirmed`. */
  currentSlot(): Promise<bigint>;
  db?: RulecheckDb;
  env?: EnvLike;
  signer?: RecordSigner;
  /**
   * The registry a stored envelope is verified against, for the same reason
   * the store takes one: a suite must be able to drive this path without
   * holding the deployment's signing key.
   */
  keys?: readonly RecordKey[];
}

/**
 * What became of the payment that went with a served record.
 *
 *   settled          the facilitator reported the transfer landed.
 *   unconfirmed      it was submitted and the answer was lost. The record is
 *                    handed over anyway: it is already in the chain and the
 *                    caller authorised the transfer, so the only thing missing
 *                    is our confirmation of a payment that probably happened.
 *                    The row stays live for reconciliation against the chain.
 *   already-settled  a payment for this digest had already settled, so this
 *                    one was never sent to the facilitator and never charged.
 */
export type PaymentState = "settled" | "unconfirmed" | "already-settled";

export type Served =
  | {
      status: 200;
      envelope: RecordEnvelope;
      stored: StoredRecord;
      payment: PaymentState;
      settlement?: SettlementResponse;
    }
  | { status: 400; code: string; reason: string }
  | { status: 402; quote: Quote; reason: string; settlement?: SettlementResponse }
  | { status: 409; reason: string; retryAfterSeconds: number }
  | { status: 503; reason: string };

function db(ports: Ports): RulecheckDb {
  return ports.db ?? (supabaseAdmin() as unknown as RulecheckDb);
}

/**
 * The record a payment's memo names, and the slot it was quoted at.
 *
 * The slot is not taken from the caller. A standard x402 client resends the
 * request it already sent and adds a header, so there is nowhere for it to put
 * a slot even if we trusted one. Instead the window is searched: for each
 * candidate slot the core is run and its digest tagged, and the run whose tag
 * matches the memo the payer signed IS the record that will be signed and
 * stored. One function, one object, no re-derivation.
 *
 * A caller returning after the window has closed is answered from the row that
 * recorded the slot, which is the case that matters when a settlement was
 * refused and the record is already waiting.
 */
async function quotedRecord(
  ask: RulecheckAsk,
  policy: RulecheckPolicy,
  payment: CheckedPayment,
  ports: Ports,
  config: PaymentConfig,
): Promise<{ record: RulecheckRecord; slot: bigint } | null> {
  const env = ports.env ?? process.env;
  const at = (slot: bigint): RulecheckRecord => rulecheck({ transaction: ask.transaction, policy, slot });

  const current = await ports.currentSlot();
  const oldest = current - windowSlots(config);
  for (let slot = current; slot >= oldest && slot >= 0n; slot--) {
    const record = at(slot);
    if (sameTag(memoTag(record.binding.digest, env), payment.tag)) return { record, slot };
  }

  const remembered = await slotForTag(db(ports), payment.tag);
  if (remembered === null) return null;
  const record = at(remembered);
  if (!sameTag(memoTag(record.binding.digest, env), payment.tag)) return null;
  return { record, slot: remembered };
}

/**
 * Signs and stores, or returns what is already stored. The first envelope wins.
 *
 * `appended` is carried out rather than swallowed because it is what decides
 * whether a settlement may be submitted at all.
 */
async function issue(
  record: RulecheckRecord,
  ports: Ports,
): Promise<{ envelope: RecordEnvelope; stored: StoredRecord; appended: boolean }> {
  const signer = ports.signer ?? recordSigner(ports.env ?? process.env);
  const put = await putRecord(record.binding.digest, signer.sign(record), {
    db: db(ports),
    ...(ports.keys ? { keys: ports.keys } : {}),
  });
  return { envelope: put.stored.envelope, stored: put.stored, appended: put.appended };
}

/**
 * The only place a settlement is authorised, and the invariant it rests on.
 *
 * A settlement may be submitted when two things hold together: the record is in
 * the store, and nobody has paid for it yet. The second is not re-queried here
 * because the spent-set already decides it — `idx_rulecheck_payments_live_claim`
 * admits one live claim per digest, and a settled payment IS live, so holding
 * the claim is itself the proof that no payment for this digest has settled.
 * A request that arrives for an already-settled digest never reaches this
 * function: it is answered from the store several branches earlier, with
 * nothing submitted and nothing charged.
 *
 * Which leaves two ways to be standing here, and both are paid for by this
 * caller:
 *
 *   "appended"     this request put the record in the chain.
 *   "held-unpaid"  the record was already there and unpaid — the residual of an
 *                  earlier append whose settlement was refused. Paying now
 *                  releases that record rather than issuing a second one.
 *
 * The second case is why this is not simply `if (appended)`. Refusing to settle
 * on "exists" without checking why it exists would hand every unpaid residual
 * record out for the price of one refused payment.
 */
function mintSettlementProof(digest: string, appended: boolean): SettlementProof {
  return SettlementProof[MINT](digest, appended ? "appended" : "held-unpaid");
}

/** What a paid caller is owed: the stored record, re-issued if somehow absent. */
async function held(record: RulecheckRecord, ports: Ports): Promise<{ envelope: RecordEnvelope; stored: StoredRecord }> {
  const stored = await getRecord(record.binding.digest, {
    db: db(ports),
    ...(ports.keys ? { keys: ports.keys } : {}),
  });
  if (stored) return { envelope: stored.envelope, stored };
  return issue(record, ports);
}

/**
 * One request, answered.
 *
 * With no payment this quotes. With a payment it verifies, appends, and only
 * then submits the settlement, and it never takes a payment twice for one
 * digest.
 *
 * A refusal from the core is an answer, not a crash: bytes that do not decode,
 * a policy that does not parse, a subject that disagrees with its policy. They
 * come back as 400 with the core's own code, and they are refused BEFORE any
 * quote, so nothing can be paid for that would then be refused.
 */
export async function serve(ask: RulecheckAsk, payment: CheckedPayment | null, ports: Ports): Promise<Served> {
  try {
    return await answer(ask, payment, ports);
  } catch (err) {
    if (err instanceof RulecheckRefusal) return { status: 400, code: err.code, reason: err.message };
    throw err;
  }
}

async function answer(ask: RulecheckAsk, payment: CheckedPayment | null, ports: Ports): Promise<Served> {
  const env = ports.env ?? process.env;
  const config = paymentConfig(env);
  const quote = (record: RulecheckRecord): Quote =>
    quoteFor(record, { resourceUrl: ask.resourceUrl, feePayer: ask.feePayer, env, config });
  // Parsed once, here: a policy that does not parse is a refusal, and a refusal
  // is answered before a price is ever quoted.
  const policy = parsePolicy(ask.policy);

  // ---- no payment: quote, and run the core to be sure a quote is honourable.
  // The result is computed and thrown away. Anything the core refuses is
  // refused here, unpaid, rather than after money has moved.
  if (!payment) {
    const record = rulecheck({ transaction: ask.transaction, policy, slot: await ports.currentSlot() });
    return { status: 402, quote: quote(record), reason: "payment is required for this request" };
  }

  const found = await quotedRecord(ask, policy, payment, ports, config);
  if (!found) {
    // The memo names no digest this server would have quoted for these bytes
    // within the window. Nothing is settled and nothing is charged; the caller
    // gets a current quote instead.
    const record = rulecheck({ transaction: ask.transaction, policy, slot: await ports.currentSlot() });
    return {
      status: 402,
      quote: quote(record),
      reason: "this payment names a request this server did not quote, or the quote has expired",
    };
  }
  const { record, slot } = found;

  const claimRequest: ClaimRequest = {
    paymentKey: payment.paymentKey,
    tag: payment.tag,
    slot,
    payer: payment.payer,
    amount: payment.amount,
    network: payment.network,
    facilitator: config.facilitator,
  };
  let claim = await claimPayment(db(ports), claimRequest);

  // ---- the retry path reconciles before it answers. An unresolved row for
  // this digest — this caller's own, or someone else's that holds the digest —
  // is otherwise a 409 that never ends (see "Reconciliation" below). Whatever
  // the chain can settle is settled, and the claim is asked once more: a
  // holder that turns out declined or released lets this payment claim the
  // digest, and a holder that turns out settled means the record is served
  // without charging this caller, as below. A claim still in flight is left
  // alone.
  if (claim.outcome !== "claimed" && (claim.status === "claimed" || claim.status === "unknown")) {
    await reconcilePayments(ports, { tag: payment.tag, caller: payment });
    claim = await claimPayment(db(ports), claimRequest);
  }

  if (claim.outcome !== "claimed") {
    // `seen` means this exact payment already has a row — the caller is
    // retrying. `held` means a DIFFERENT payment holds this digest, which is
    // the genuine double-payment: it is never sent to the facilitator, so it
    // expires with its blockhash and costs whoever sent it nothing.
    const mine = claim.outcome === "seen";
    switch (claim.status) {
      case "settled": {
        const { envelope, stored } = await held(record, ports);
        return {
          status: 200,
          envelope,
          stored,
          payment: mine ? "settled" : "already-settled",
          ...(mine && claim.settle_signature
            ? {
                settlement: {
                  success: true,
                  transaction: claim.settle_signature,
                  network: payment.network,
                  payer: payment.payer,
                } satisfies SettlementResponse,
              }
            : {}),
        };
      }
      case "unknown": {
        // A settlement was submitted for this digest and its answer was lost.
        // For the caller who submitted it, that is not a reason to withhold the
        // record: it is already in the chain and they authorised the transfer,
        // so they get it and the row stays live for reconciliation. For anyone
        // else, it is a reason to wait rather than submit a second transfer for
        // a digest that may well be paid.
        if (mine && claim.record_appended) {
          const { envelope, stored } = await held(record, ports);
          return { status: 200, envelope, stored, payment: "unconfirmed" };
        }
        return {
          status: 409,
          reason: "a payment for this request has an unresolved settlement; retry shortly",
          retryAfterSeconds: 5,
        };
      }
      case "claimed":
        // In flight. "Not yet", never "no": nothing else is charged, and the
        // retry is answered from whatever that attempt becomes.
        return {
          status: 409,
          reason: "a payment for this request is being settled; retry shortly",
          retryAfterSeconds: 3,
        };
      default:
        // This exact payment was refused or released earlier. Re-presenting it
        // would only be refused again, so the caller is re-quoted for the SAME
        // digest: if the record was appended before that refusal it is still
        // there, and paying again hands it over rather than issuing a second.
        return {
          status: 402,
          quote: quote(record),
          reason: claim.record_appended
            ? "this payment was not settled; the record for this request is issued and held, and a new payment for the same quote releases it"
            : "this payment was not settled; a new payment for the same quote is required",
        };
    }
  }

  // ---- verify: the facilitator reads the payment. No money moves, and
  // nothing is reserved on-chain by doing it.
  const checked = await ports.facilitator.verify(payment.payload, payment.requirements);
  if (!checked.isValid) {
    await finishPayment(db(ports), payment.paymentKey, "released", null, checked.invalidReason ?? "not valid");
    return {
      status: 402,
      quote: quote(record),
      reason: `the facilitator did not accept this payment: ${checked.invalidReason ?? "no reason given"}`,
    };
  }

  // ---- the signing key must load before anything is appended. A record we
  // cannot sign is not a record, and finding that out after settling would be
  // the exact "paid for nothing" this order exists to prevent.
  let signer: RecordSigner;
  try {
    signer = ports.signer ?? recordSigner(env);
  } catch (err) {
    await finishPayment(db(ports), payment.paymentKey, "released", null, "no signing key");
    return { status: 503, reason: err instanceof Error ? err.message : String(err) };
  }

  // ---- append. Still nothing has moved: if this throws, the claim is
  // released and the caller is told to try again, out of pocket by nothing.
  let issued: { envelope: RecordEnvelope; stored: StoredRecord; appended: boolean };
  try {
    issued = await issue(record, { ...ports, signer });
  } catch (err) {
    await finishPayment(db(ports), payment.paymentKey, "released", null, "the record could not be stored");
    return { status: 503, reason: err instanceof Error ? err.message : String(err) };
  }

  // ---- the append is durable, and the row says so BEFORE settlement is
  // attempted. A process that dies in the next few hundred milliseconds leaves
  // `record_appended` true and the status still 'claimed', which is exactly
  // what a later reader needs to tell "never settled" from "settled and lost".
  const marked = await markAppended(db(ports), payment.paymentKey, payment.payload);
  if (marked !== "claimed") {
    return {
      status: 409,
      reason: "this claim was resolved by another request while the record was being stored; retry shortly",
      retryAfterSeconds: 3,
    };
  }

  // ---- settle, last, and only with a proof the step above mints.
  //
  // WHY THE ORDER IS LOAD-BEARING, FOR THE NEXT READER WHO IS TEMPTED TO SWAP
  // THESE TWO STEPS. x402 has no refund. Whichever of "store the record" and
  // "take the money" goes second is the one that can leave a party short, so
  // the order decides who carries that. Settling first would put it on the
  // caller: a payment that lands and a record that then cannot be signed or
  // stored is money we cannot give back. Appending first puts it on us, and
  // the proof below is what stops the order drifting back — `settle` cannot be
  // called without one, and `mintSettlementProof` cannot run before the record
  // is in the store.
  //
  // THE THREE WAYS THIS ENDS.
  //
  //   settled   — the ordinary path. The record was stored, then paid for.
  //
  //   declined  — the facilitator refused, definitively: the funds moved out
  //               from under the payment, the blockhash lapsed, the payer's
  //               balance is short. The record exists and nobody paid for it.
  //               It is NOT withdrawn (the chain is append-only, and dropping a
  //               link to tidy up would break the one property the chain
  //               gives), and it is NOT handed over: the caller gets 402 and
  //               the same quote, so paying again releases the record that is
  //               already waiting rather than issuing a second one. The row
  //               keeps `record_appended` true with status 'declined', which is
  //               what makes "records we issued and were not paid for" a query
  //               in migration 012 rather than a guess. A caller can provoke
  //               this deliberately; it buys them a record they are not given,
  //               and costs them a network fee per attempt.
  //
  //   unknown   — submitted, and the answer was lost: a timeout, a dropped
  //               connection, a facilitator that died mid-call. The transfer
  //               may well have landed. The record is handed over, because the
  //               caller authorised the transfer and the record is already in
  //               the chain, and the row stays live so that no second transfer
  //               is taken for this digest and the chain can be read later to
  //               settle the question. The loss in this case is ours and it is
  //               bounded by one call's price: we may have been paid and be
  //               unable to say so.
  const outcome = await ports.facilitator.settle(
    payment.payload,
    payment.requirements,
    mintSettlementProof(record.binding.digest, issued.appended),
  );

  if (outcome.kind === "settled") {
    await finishPayment(db(ports), payment.paymentKey, "settled", outcome.signature, null);
    return {
      status: 200,
      envelope: issued.envelope,
      stored: issued.stored,
      payment: "settled",
      settlement: {
        success: true,
        transaction: outcome.signature,
        network: payment.network,
        payer: outcome.payer ?? payment.payer,
      },
    };
  }

  if (outcome.kind === "declined") {
    await finishPayment(db(ports), payment.paymentKey, "declined", null, outcome.reason);
    return {
      status: 402,
      quote: quote(record),
      reason:
        "the payment was not settled; the record for this request is issued and held, and a new payment for the " +
        "same quote releases it",
      settlement: { success: false, transaction: "", network: payment.network, errorReason: outcome.reason },
    };
  }

  await finishPayment(db(ports), payment.paymentKey, "unknown", null, outcome.reason);
  return { status: 200, envelope: issued.envelope, stored: issued.stored, payment: "unconfirmed" };
}

// ---------------------------------------------------------------------------
// Reconciliation (migration 013)
// ---------------------------------------------------------------------------
//
// WHY THIS IS NOT OPTIONAL. The spent-set admits one live row per digest, and
// that same rule means an UNRESOLVED row blocks everyone else: while a payment
// sits in 'claimed' or 'unknown', every other payer for its digest gets 409.
// A process that dies after marking the append leaves 'claimed' forever; a
// settlement whose answer was lost leaves 'unknown' forever. Without this
// section, each crash or timeout makes a digest permanently unbuyable. Anyone
// tempted to remove it as housekeeping: it is the only thing that ever moves
// those rows again.
//
// THE ORDER OF THE CHAIN READS IS LOAD-BEARING. Expiry is read BEFORE the
// search. Once the blockhash is dead at `finalized`, nothing carrying it can
// land later, so a search made after that is final. Searching first and
// checking expiry second leaves a gap in which the transfer lands unseen and
// the payment is then declined as if it had not, which is how a second payer
// gets to buy a digest someone already paid for.
//
// ONLY THE CHAIN DECLINES. A resubmitted settlement that the facilitator
// refuses does NOT decline the row: the refusal may mean "already processed",
// which is the transfer having landed. While the blockhash lives the row stays
// 'unknown' and the next pass asks again; once it is dead, the search decides.

/** A 'claimed' row younger than this, since its last write, may still be in flight. */
export const RECONCILE_STALE_SECONDS = 60;
/**
 * Expiry is only believed for a row at least this old. The blockhash predates
 * the claim and lives ~60-90s, so a real expiry is always past this; an RPC
 * node that has never seen a fresh blockhash also answers "not valid", and this
 * floor is what keeps that from being read as expired.
 */
export const EXPIRY_FLOOR_SECONDS = 120;

interface ReconcileRow {
  payment_key: string;
  digest_tag: string;
  status: PaymentStatus;
  slot: string | number;
  record_appended: boolean;
  payment_payload: PaymentPayload | null;
  age_seconds: number;
}

export interface Reconciled {
  paymentKey: string;
  from: PaymentStatus;
  /** The status the row was moved to, or null when it was left as it was. */
  to: PaymentStatus | null;
  reason: string;
}

/** Raised when the bytes about to be resubmitted are not the bytes the row was claimed for. */
export class PaymentMismatch extends Error {
  constructor(reason: string) {
    super(`refusing to resubmit: ${reason}`);
    this.name = "PaymentMismatch";
  }
}

async function resolve(
  d: PaymentDb,
  row: ReconcileRow,
  to: PaymentStatus,
  signature: string | null,
  note: string,
): Promise<Reconciled> {
  const [after] = await call(d, "rulecheck_resolve_payment", {
    p_payment_key: row.payment_key,
    p_from_status: row.status,
    p_from_appended: row.record_appended,
    p_to_status: to,
    p_settle_signature: signature,
    p_note: note,
  });
  if (after?.changed !== true) {
    // Someone else moved it first — a live request or another reconciler. Theirs stands.
    return { paymentKey: row.payment_key, from: row.status, to: null, reason: "resolved elsewhere first" };
  }
  return { paymentKey: row.payment_key, from: row.status, to, reason: note };
}

/**
 * Belt and braces on top of the spent-set. Resubmitting is safe because the
 * chain dedupes an identical transaction; this makes sure it IS identical. The
 * stored payload must hash to the row's key, and when the retry path holds the
 * caller's own copy, its message must match the stored one byte for byte. A
 * bug that swapped payloads would otherwise turn a retry into a second,
 * distinct transfer.
 */
function assertSameMessage(row: ReconcileRow, stored: PaymentFacts, caller?: CheckedPayment): void {
  if (stored.paymentKey !== row.payment_key) {
    throw new PaymentMismatch("the stored payment does not hash to the row it was claimed under");
  }
  if (caller && caller.paymentKey === row.payment_key) {
    const theirs = paymentFacts(caller.payload).message;
    if (!Buffer.from(theirs).equals(Buffer.from(stored.message))) {
      throw new PaymentMismatch("the caller's payment message differs from the stored one");
    }
  }
}

async function reconcileRow(row: ReconcileRow, ports: Ports, caller?: CheckedPayment): Promise<Reconciled> {
  const d = db(ports);
  const unchanged = (reason: string): Reconciled => ({ paymentKey: row.payment_key, from: row.status, to: null, reason });

  // No append mark means no settlement was ever submitted: settle is only
  // reached after the mark. Nothing to ask the chain; the claim is dropped,
  // and the compare-and-set refuses if the request woke up and marked it since.
  if (row.status === "claimed" && !row.record_appended) {
    return resolve(d, row, "released", null, "abandoned before the record was marked stored; nothing was submitted");
  }
  if (!row.payment_payload) {
    return unchanged("no stored payload (appended before migration 013): resolve by hand against the chain");
  }

  let facts: PaymentFacts;
  try {
    facts = paymentFacts(row.payment_payload);
    assertSameMessage(row, facts, caller);
  } catch (err) {
    return unchanged(err instanceof Error ? err.message : String(err));
  }

  // 1. Expiry first (see above), believed only past the floor.
  const expired = row.age_seconds >= EXPIRY_FLOOR_SECONDS && !(await ports.chain.blockhashLive(facts.blockhash));

  // 2. Then the search, which is final if 1. said expired.
  const landed = await ports.chain.findPayment({
    account: facts.destination,
    tag: row.digest_tag,
    paymentKey: row.payment_key,
    fromSlot: BigInt(row.slot),
  });
  if (landed && !landed.failed) {
    return resolve(d, row, "settled", landed.signature, "found on-chain by reconciliation");
  }
  if (landed?.failed) {
    // Landed and failed: the signature is spent, so this exact transfer can never land now.
    return resolve(d, row, "declined", null, "landed on-chain and failed; no transfer");
  }
  if (expired) {
    return resolve(d, row, "declined", null, "blockhash expired and the payment never landed");
  }

  // 3. Not landed, still able to land: submit the SAME payload again. A stale
  // 'claimed' row is first moved to 'unknown', which is what it is: a
  // settlement may have gone out and nobody heard back.
  let current = row;
  if (row.status === "claimed") {
    const moved = await resolve(d, row, "unknown", null, "stale claim with the record stored; resubmitting");
    if (moved.to !== "unknown") return moved;
    current = { ...row, status: "unknown" };
  }
  const outcome = await ports.facilitator.settle(
    row.payment_payload,
    row.payment_payload.accepted,
    SettlementProof[MINT](row.payment_key, "resubmitted"),
  );
  if (outcome.kind === "settled") {
    return resolve(d, current, "settled", outcome.signature, "settled on resubmission");
  }
  return unchanged(`resubmitted, ${outcome.kind}: ${outcome.reason}; left open while the blockhash lives`);
}

/**
 * Resolves what can be resolved of the unresolved payment rows: those for one
 * digest tag (the retry path), or all of them (the sweep).
 *
 * A row the chain cannot answer for is left as it was and reported, never
 * guessed at: every doubt falls towards "still open", because an open row costs
 * a 409 and a wrongly declined one can cost a second payment for a digest.
 */
export async function reconcilePayments(
  ports: Ports,
  scope: { tag?: string; caller?: CheckedPayment } = {},
): Promise<Reconciled[]> {
  const rows = (await call(db(ports), "rulecheck_payments_to_reconcile", {
    p_digest_tag: scope.tag ?? null,
    p_stale_seconds: RECONCILE_STALE_SECONDS,
  })) as unknown as ReconcileRow[];

  const out: Reconciled[] = [];
  for (const row of rows) {
    try {
      out.push(await reconcileRow(row, ports, scope.caller));
    } catch (err) {
      out.push({ paymentKey: row.payment_key, from: row.status, to: null, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

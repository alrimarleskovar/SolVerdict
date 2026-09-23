// SPDX-License-Identifier: Apache-2.0
/**
 * The paid rulecheck route, end to end, with no network and no money.
 *
 * WHAT IS REAL HERE. The route handler, the quote, the payment reader, the
 * core, the record signing, the seal, the chain, and the spent-set semantics of
 * migration 012 — reimplemented in memory from the SQL so the branch table is
 * exercised rather than assumed. A real transaction is built and really signed;
 * a real payment transaction is built and really signed by a payer who is not
 * the fee payer, exactly as the exact scheme requires.
 *
 * WHAT IS A STAND-IN. The facilitator, which is a third party over HTTP, and
 * the chain's current slot. Both are ports, and both are the things a local
 * test cannot honestly have.
 *
 * THE TWO PROPERTIES THIS FILE EXISTS TO HOLD.
 *
 *   1. A settlement is submitted ONLY after the record is durably stored, and
 *      never for a digest someone already paid for. The call log is asserted in
 *      order, and the "already settled" and "second payment" paths assert that
 *      the facilitator was not asked to settle at all.
 *   2. The digest in the 402 quote and the digest bound in the stored record
 *      are the same value from the same function — `rulecheck()` in
 *      rulecheck/rulecheck.ts, field `record.binding.digest`. The quote reads
 *      that field off the record; the paid path stores the very record whose
 *      digest matched the memo. The test compares the two across the wire.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createApproveCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { publicKeyForSeed } from "../../rulecheck/envelope";
import type { RecordKey } from "../../rulecheck/keys";
import { CHAIN_GENESIS, nextChainHash } from "../../rulecheck/chain";
import { lookupKeyFor } from "../../rulecheck/seal";
import { handle, type RouteDeps } from "../app/api/rulecheck/route";
import { recordSigner } from "./rulecheck-key";
import type { Facilitator, PaymentChain, PaymentPayload, PaymentRequirements, SettleOutcome } from "./rulecheck-payment";
import type { RulecheckDb } from "./rulecheck-store";

// ---------------------------------------------------------------------------
// Fixtures: keys, the transaction being checked, and the environment
// ---------------------------------------------------------------------------
const key = (label: string) => Keypair.fromSeed(createHash("sha256").update(`route-test/${label}`).digest());

const SUBJECT = key("subject");
const DELEGATE = key("delegate").publicKey;
const TOKEN_MINT = key("token-mint").publicKey;
const PAYER = key("payer");
const FEE_PAYER = key("fee-payer").publicKey;
const PAY_TO = key("pay-to").publicKey;
const USDC = key("usdc").publicKey;
const BLOCKHASH = bs58.encode(createHash("sha256").update("route-test/blockhash").digest());

const RECORD_SEED = createHash("sha256").update("route-test/record-key").digest();
const KEY_ID = "rk-route-test";
const KEYS: RecordKey[] = [{ keyId: KEY_ID, publicKey: publicKeyForSeed(RECORD_SEED), from: "2026-09-20" }];

const PRICE = "20000";
const SLOT = 364_000_000n;
const ENV = {
  RULECHECK_PRICE_ATOMIC: PRICE,
  RULECHECK_PAYMENT_WALLET: PAY_TO.toBase58(),
  RULECHECK_PAYMENT_ASSET: USDC.toBase58(),
  RULECHECK_PAYMENT_NETWORK: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  FACILITATOR_URL: "https://facilitator.test",
  RULECHECK_QUOTE_SECONDS: "30",
  RULECHECK_PAYMENT_TAG_KEY: "t".repeat(64),
};

const POLICY = {
  id: "route-test-approve-limit",
  version: 1,
  subject: SUBJECT.publicKey.toBase58(),
  approveLimit: "1000000",
};

/** The transaction under check: an approve well over the policy's limit. */
function approveTx(amount: bigint): string {
  const source = getAssociatedTokenAddressSync(TOKEN_MINT, SUBJECT.publicKey);
  const message = new TransactionMessage({
    payerKey: SUBJECT.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      createApproveCheckedInstruction(source, TOKEN_MINT, DELEGATE, SUBJECT.publicKey, amount, 6),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([SUBJECT]);
  return Buffer.from(tx.serialize()).toString("base64");
}

/** The payment the caller authorises: fee payer is the facilitator's, signed by the payer. */
function buildPayment(requirements: PaymentRequirements, opts: { amount?: string; nonce?: string } = {}): string {
  const source = getAssociatedTokenAddressSync(USDC, PAYER.publicKey, true);
  const destination = getAssociatedTokenAddressSync(USDC, PAY_TO, true);
  const memo = new TransactionInstruction({
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    keys: [],
    data: Buffer.from(requirements.extra.memo, "utf8"),
  });
  const message = new TransactionMessage({
    payerKey: FEE_PAYER,
    // A different blockhash is what makes a re-authorised payment a DIFFERENT
    // transaction, which is the genuine double-payment case.
    recentBlockhash: bs58.encode(createHash("sha256").update(`blockhash/${opts.nonce ?? "one"}`).digest()),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      createTransferCheckedInstruction(
        source,
        USDC,
        destination,
        PAYER.publicKey,
        BigInt(opts.amount ?? requirements.amount),
        6,
      ),
      memo,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([PAYER]);
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: Buffer.from(tx.serialize()).toString("base64") },
    }),
    "utf8",
  ).toString("base64");
}

// ---------------------------------------------------------------------------
// The database, in memory, from migrations 011 and 012
// ---------------------------------------------------------------------------
interface RecordRow {
  seq: number;
  lookup_key: string;
  record_sha256: string;
  key_id: string;
  sealed: string;
  prev_chain_hash: string;
  chain_hash: string;
  appended_at: string;
}
interface PaymentRow {
  payment_key: string;
  digest_tag: string;
  status: "claimed" | "settled" | "declined" | "released" | "unknown";
  slot: string;
  record_appended: boolean;
  settle_signature: string | null;
  note: string | null;
  payment_payload: unknown;
  created_at: number;
  updated_at: number;
}
const LIVE = ["claimed", "settled", "unknown"];

/** The database's clock, in ms. Tests move it forward to make a claim stale. */
interface Clock {
  t: number;
}

function memoryDb(log: string[], clock: Clock = { t: Date.now() }) {
  const records: RecordRow[] = [];
  const payments: PaymentRow[] = [];
  const head = () => (records.length > 0 ? records[records.length - 1]!.chain_hash : CHAIN_GENESIS);
  const answer = (rows: unknown[]) => Promise.resolve({ data: rows, error: null });

  const db: RulecheckDb = {
    rpc(fn, params) {
      log.push(fn);
      const p = params as Record<string, string>;

      if (fn === "rulecheck_append_record") {
        const existing = records.find((r) => r.lookup_key === p.p_lookup_key);
        if (existing) return answer([{ status: "exists", ...existing }]);
        if (head() !== p.p_prev_chain_hash) {
          return answer([{ status: "head-moved", chain_hash: head() }]);
        }
        const row: RecordRow = {
          seq: records.length + 1,
          lookup_key: p.p_lookup_key!,
          record_sha256: p.p_record_sha256!,
          key_id: p.p_key_id!,
          sealed: p.p_sealed!,
          prev_chain_hash: p.p_prev_chain_hash!,
          chain_hash: p.p_chain_hash!,
          appended_at: new Date().toISOString(),
        };
        assert.equal(row.chain_hash, nextChainHash(row.prev_chain_hash, row.record_sha256), "the chain link must hold");
        records.push(row);
        return answer([{ status: "appended", ...row }]);
      }

      if (fn === "rulecheck_claim_payment") {
        const mine = payments.find((r) => r.payment_key === p.p_payment_key);
        if (mine) {
          return answer([
            {
              outcome: "seen",
              status: mine.status,
              slot: mine.slot,
              record_appended: mine.record_appended,
              settle_signature: mine.settle_signature,
              note: mine.note,
            },
          ]);
        }
        const live = payments.filter((r) => r.digest_tag === p.p_digest_tag && LIVE.includes(r.status)).at(-1);
        if (live) {
          // The signature is withheld from a caller who is not the payer.
          return answer([
            {
              outcome: "held",
              status: live.status,
              slot: live.slot,
              record_appended: live.record_appended,
              settle_signature: null,
              note: live.note,
            },
          ]);
        }
        const row: PaymentRow = {
          payment_key: p.p_payment_key!,
          digest_tag: p.p_digest_tag!,
          status: "claimed",
          slot: String(p.p_slot),
          record_appended: false,
          settle_signature: null,
          note: null,
          payment_payload: null,
          created_at: clock.t,
          updated_at: clock.t,
        };
        payments.push(row);
        return answer([{ outcome: "claimed", status: row.status, slot: row.slot, record_appended: false, settle_signature: null, note: null }]);
      }

      if (fn === "rulecheck_payment_for_tag") {
        const rows = payments.filter((r) => r.digest_tag === p.p_digest_tag);
        const row = rows.filter((r) => LIVE.includes(r.status)).at(-1) ?? rows.at(-1);
        return answer(row ? [{ status: row.status, slot: row.slot, record_appended: row.record_appended }] : []);
      }

      if (fn === "rulecheck_mark_appended") {
        const row = payments.find((r) => r.payment_key === p.p_payment_key);
        if (row && row.status === "claimed") row.record_appended = true;
        return answer([{ status: row?.status ?? "released", record_appended: row?.record_appended ?? false }]);
      }

      if (fn === "rulecheck_mark_appended_with_payload") {
        assert.ok(params.p_payment_payload, "013 requires the payload with the append mark");
        const row = payments.find((r) => r.payment_key === p.p_payment_key);
        if (row && row.status === "claimed") {
          row.record_appended = true;
          row.payment_payload = structuredClone(params.p_payment_payload);
          row.updated_at = clock.t;
        }
        return answer([{ status: row?.status ?? "released", record_appended: row?.record_appended ?? false }]);
      }

      if (fn === "rulecheck_payments_to_reconcile") {
        const stale = Number(params.p_stale_seconds) * 1000;
        const rows = payments
          .filter((r) => params.p_digest_tag === null || r.digest_tag === params.p_digest_tag)
          .filter((r) => r.status === "unknown" || (r.status === "claimed" && r.updated_at < clock.t - stale))
          .map((r) => ({
            payment_key: r.payment_key,
            digest_tag: r.digest_tag,
            status: r.status,
            slot: r.slot,
            record_appended: r.record_appended,
            payment_payload: r.payment_payload === null ? null : structuredClone(r.payment_payload),
            age_seconds: Math.floor((clock.t - r.created_at) / 1000),
          }));
        return answer(rows);
      }

      if (fn === "rulecheck_resolve_payment") {
        const from = params.p_from_status as string;
        const appended = params.p_from_appended as boolean;
        const to = params.p_to_status as PaymentRow["status"];
        const allowed =
          (from === "claimed" && !appended && to === "released") ||
          (from === "claimed" && appended && ["unknown", "settled", "declined"].includes(to)) ||
          (from === "unknown" && ["settled", "declined"].includes(to));
        assert.ok(allowed, `013 refuses ${from} (appended ${appended}) to ${to}`);
        const row = payments.find((r) => r.payment_key === p.p_payment_key);
        const changed = !!row && row.status === from && row.record_appended === appended;
        if (changed) {
          row.status = to;
          row.settle_signature = (params.p_settle_signature as string | null) ?? row.settle_signature;
          row.note = (params.p_note as string | null) ?? row.note;
          row.updated_at = clock.t;
        }
        return answer([
          { status: row?.status, record_appended: row?.record_appended, settle_signature: row?.settle_signature ?? null, changed },
        ]);
      }

      if (fn === "rulecheck_finish_payment") {
        const row = payments.find((r) => r.payment_key === p.p_payment_key);
        const to = p.p_status as PaymentRow["status"];
        if (row && (row.status === "claimed" || (row.status === "unknown" && (to === "settled" || to === "declined")))) {
          row.updated_at = clock.t;
          row.status = to;
          row.settle_signature = (p.p_settle_signature as string | null) ?? row.settle_signature;
          row.note = (p.p_note as string | null) ?? row.note;
        }
        return answer([
          { status: row?.status ?? "released", record_appended: row?.record_appended ?? false, settle_signature: row?.settle_signature ?? null },
        ]);
      }

      throw new Error(`the route called an unknown function: ${fn}`);
    },
    from(table) {
      assert.equal(table, "rulecheck_records", "the rulecheck side reads only its own tables");
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: () => Promise.resolve({ data: records.find((r) => r.lookup_key === value) ?? null, error: null }),
          }),
        }),
      };
    },
  };
  return { db, records, payments };
}

// ---------------------------------------------------------------------------
// The facilitator, as a stand-in that records what it was asked
// ---------------------------------------------------------------------------
function mockFacilitator(log: string[], outcome: () => SettleOutcome) {
  const calls = { verify: 0, settle: 0, settled: [] as PaymentPayload[] };
  const facilitator: Facilitator = {
    async verify() {
      log.push("facilitator.verify");
      calls.verify++;
      return { isValid: true, payer: PAYER.publicKey.toBase58() };
    },
    async settle(payload, _requirements, proof) {
      log.push("facilitator.settle");
      calls.settle++;
      calls.settled.push(structuredClone(payload));
      assert.ok(proof && typeof proof.ref === "string", "a settlement must carry its proof of a stored record");
      assert.ok(
        log.indexOf("rulecheck_append_record") >= 0 && log.indexOf("rulecheck_append_record") < log.lastIndexOf("facilitator.settle"),
        "the record must be appended before a settlement is submitted",
      );
      return outcome();
    },
  };
  return { facilitator, calls };
}

/** The chain, as a stand-in: whatever the test says it is, and a log of what was asked. */
function mockChain(log: string[], state: { live: boolean; landed: { signature: string; failed: boolean } | null }) {
  const calls = { live: 0, find: 0 };
  const chain: PaymentChain = {
    async blockhashLive() {
      log.push("chain.blockhashLive");
      calls.live++;
      return state.live;
    },
    async findPayment() {
      log.push("chain.findPayment");
      calls.find++;
      return state.landed;
    },
  };
  return { chain, calls, state };
}

function deps(db: RulecheckDb, facilitator: Facilitator, slot = SLOT, chain?: PaymentChain): RouteDeps {
  return {
    ports: {
      facilitator,
      chain: chain ?? mockChain([], { live: true, landed: null }).chain,
      currentSlot: async () => slot,
      db,
      env: ENV,
      signer: recordSigner(
        { RULECHECK_RECORD_KEY_ID: KEY_ID, RULECHECK_RECORD_SIGNING_SEED: bs58.encode(RECORD_SEED) },
        KEYS,
      ),
      keys: KEYS,
    },
    feePayer: async () => FEE_PAYER.toBase58(),
  };
}

const post = (body: unknown, header?: string) =>
  new Request("https://solverdict.test/api/rulecheck", {
    method: "POST",
    headers: { "content-type": "application/json", ...(header ? { "PAYMENT-SIGNATURE": header } : {}) },
    body: JSON.stringify(body),
  });

/** `RULECHECK_SHOW=1` prints the two responses in full — the handshake, readable. */
const show = (label: string, res: Response, body: unknown) => {
  if (!process.env.RULECHECK_SHOW) return;
  const headers = [...res.headers].filter(([k]) => k.toLowerCase().startsWith("payment") || k === "retry-after");
  console.log(`\n--- ${label}: HTTP ${res.status}`);
  for (const [k, v] of headers) console.log(`${k}: ${v.length > 96 ? `${v.slice(0, 96)}… (${v.length} bytes)` : v}`);
  console.log(JSON.stringify(body, null, 2));
};

let held = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  held++;
  console.log(`  ✓ ${name}`);
};

// ---------------------------------------------------------------------------
const TX = approveTx(2n ** 64n - 1n);
const SETTLED: SettleOutcome = { kind: "settled", signature: bs58.encode(createHash("sha512").update("settle/one").digest()), payer: PAYER.publicKey.toBase58() };

// Node runs this file as CommonJS under tsx, where top-level await is not
// available — hence one async entry point rather than a script body.
async function main(): Promise<void> {
console.log("\nrulecheck route — unpaid probe, paid call, and the branches around them\n");

await test("an unpaid POST is quoted, with the binding digest echoed", async () => {
  const log: string[] = [];
  const { db } = memoryDb(log);
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const res = await handle(post({ transaction: TX, policy: POLICY }), deps(db, facilitator));
  const body = (await res.json()) as Record<string, any>;

  assert.equal(res.status, 402);
  assert.ok(res.headers.get("PAYMENT-REQUIRED"), "the protocol object travels in the header");
  assert.equal(body.accepts[0].amount, PRICE);
  assert.equal(body.accepts[0].payTo, PAY_TO.toBase58());
  assert.match(body.rulecheck.bindingDigest, /^[0-9a-f]{64}$/);
  assert.equal(body.rulecheck.policy.subject, POLICY.subject, "the policy is echoed so the caller can recompute");
  assert.equal(calls.verify + calls.settle, 0, "an unpaid probe asks the facilitator nothing");

  const header = Buffer.from(res.headers.get("PAYMENT-REQUIRED")!, "base64").toString("utf8");
  assert.ok(!header.includes(body.rulecheck.bindingDigest), "the digest must not travel to the facilitator");
  show("unpaid POST", res, body);
});

await test("a paid POST returns the sealed record, and settles only after the append", async () => {
  const log: string[] = [];
  const { db, records, payments } = memoryDb(log);
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const d = deps(db, facilitator);

  const quoted = await handle(post({ transaction: TX, policy: POLICY }), d);
  const quote = (await quoted.json()) as Record<string, any>;
  const header = buildPayment(quote.accepts[0]);

  const res = await handle(post({ transaction: TX, policy: POLICY }, header), d);
  const body = (await res.json()) as Record<string, any>;

  assert.equal(res.status, 200);
  assert.equal(body.payment, "settled");
  assert.equal(
    body.envelope.record.binding.digest,
    quote.rulecheck.bindingDigest,
    "the quoted digest and the stored record's digest are the same value from rulecheck()",
  );
  assert.equal(body.envelope.record.results[0].state, "violates");
  assert.equal(body.envelope.keyId, KEY_ID);
  assert.equal(body.chain.seq, 1);
  assert.equal(records.length, 1);
  assert.equal(payments[0].status, "settled");

  const settlement = JSON.parse(Buffer.from(res.headers.get("PAYMENT-RESPONSE")!, "base64").toString("utf8"));
  assert.equal(settlement.success, true);
  assert.equal(settlement.transaction, SETTLED.kind === "settled" ? SETTLED.signature : "");

  assert.deepEqual(
    log,
    [
      "rulecheck_claim_payment",
      "facilitator.verify",
      "rulecheck_append_record",
      "rulecheck_mark_appended_with_payload",
      "facilitator.settle",
      "rulecheck_finish_payment",
    ],
    "claim, verify, append, then settle — in that order",
  );
  assert.ok(!JSON.stringify(body.envelope).includes(PAYER.publicKey.toBase58()), "no payer enters the record");
  show("paid POST", res, body);
});

await test("the same payment, resent after a lost response, is not settled twice", async () => {
  const log: string[] = [];
  const { db, records } = memoryDb(log);
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  const header = buildPayment(quote.accepts[0]);

  const first = (await (await handle(post({ transaction: TX, policy: POLICY }, header), d)).json()) as Record<string, any>;
  const again = await handle(post({ transaction: TX, policy: POLICY }, header), d);
  const body = (await again.json()) as Record<string, any>;

  assert.equal(again.status, 200);
  assert.equal(body.payment, "settled");
  assert.equal(calls.settle, 1, "one payment, one settlement");
  assert.equal(records.length, 1, "one digest, one record");
  assert.equal(body.envelope.issuedAt, first.envelope.issuedAt, "the first envelope is the one that stands");
});

await test("a second payment for the same digest is never submitted", async () => {
  const log: string[] = [];
  const { db, records } = memoryDb(log);
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;

  await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);
  const second = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  const body = (await second.json()) as Record<string, any>;

  assert.equal(second.status, 200);
  assert.equal(body.payment, "already-settled", "the record is returned and the second payment is not taken");
  assert.equal(second.headers.get("PAYMENT-RESPONSE"), null, "nothing settled, so there is no settlement to report");
  assert.equal(calls.settle, 1);
  assert.equal(records.length, 1);
});

await test("a refused settlement holds the record back, and paying again releases it", async () => {
  const log: string[] = [];
  const { db, records, payments } = memoryDb(log);
  let outcome: SettleOutcome = { kind: "declined", reason: "insufficient_funds" };
  const { facilitator, calls } = mockFacilitator(log, () => outcome);
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;

  const refused = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);
  const refusedBody = (await refused.json()) as Record<string, any>;
  assert.equal(refused.status, 402);
  assert.equal(refusedBody.envelope, undefined, "a record is never handed over unpaid");
  assert.equal(records.length, 1, "the record stays in the chain: it is append-only");
  assert.equal(payments[0].status, "declined");
  assert.equal(payments[0].record_appended, true, "the row says a record was issued and not paid for");
  assert.equal(
    refusedBody.rulecheck.bindingDigest,
    quote.rulecheck.bindingDigest,
    "the same digest is re-quoted, so paying again releases the record already stored",
  );

  outcome = SETTLED;
  const released = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  const body = (await released.json()) as Record<string, any>;
  assert.equal(released.status, 200);
  assert.equal(body.payment, "settled");
  assert.equal(body.chain.seq, 1, "the record released is the one that was already there");
  assert.equal(records.length, 1, "no second record is issued");
  assert.equal(calls.settle, 2, "the second payment is the one that pays for it");
});

await test("a lost settlement answer still hands over the record, and stays open for reconciliation", async () => {
  const log: string[] = [];
  const { db, payments } = memoryDb(log);
  const { facilitator } = mockFacilitator(log, () => ({ kind: "unknown", reason: "timed out" }));
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;

  const res = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0])), d);
  const body = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 200);
  assert.equal(body.payment, "unconfirmed");
  assert.equal(res.headers.get("PAYMENT-RESPONSE"), null, "we do not claim a settlement we could not read");
  assert.equal(payments[0].status, "unknown", "the claim stays live so no second payment is taken");
});

await test("a payment whose memo is not the tag it names is refused before anything is asked", async () => {
  const log: string[] = [];
  const { db } = memoryDb(log);
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;

  const tampered = { ...quote.accepts[0], extra: { ...quote.accepts[0].extra, memo: "f".repeat(64) } };
  const header = buildPayment(quote.accepts[0]);
  const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  payload.accepted = tampered; // the memo in the terms no longer matches the signed one
  const res = await handle(
    post({ transaction: TX, policy: POLICY }, Buffer.from(JSON.stringify(payload), "utf8").toString("base64")),
    d,
  );

  assert.equal(res.status, 400);
  assert.equal(calls.verify + calls.settle, 0, "a payment we cannot read is never shown to a facilitator");
});

await test("a payment for a tag this route never issued is refused, and nothing is settled", async () => {
  const log: string[] = [];
  const { db, records } = memoryDb(log);
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  const foreign = { ...quote.accepts[0], extra: { ...quote.accepts[0].extra, memo: "a".repeat(64) } };

  const res = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(foreign)), d);
  assert.equal(res.status, 402, "a quote, not a charge");
  assert.equal(calls.settle, 0);
  assert.equal(records.length, 0, "nothing is stored for a request nobody paid for");
});

await test("bytes that do not decode are refused with the core's own code, never quoted", async () => {
  const log: string[] = [];
  const { db } = memoryDb(log);
  const { facilitator } = mockFacilitator(log, () => SETTLED);
  const res = await handle(
    post({ transaction: Buffer.from("not a transaction").toString("base64"), policy: POLICY }),
    deps(db, facilitator),
  );
  const body = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 400);
  assert.equal(body.error, "undecodable-transaction");
});

await test("the stored row is sealed under the digest and names nothing about the payer", async () => {
  const log: string[] = [];
  const { db, records } = memoryDb(log);
  const { facilitator } = mockFacilitator(log, () => SETTLED);
  const d = deps(db, facilitator);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0])), d);

  const row = records[0]!;
  assert.equal(row.lookup_key, lookupKeyFor(quote.rulecheck.bindingDigest), "addressable by the digest and nothing else");
  const raw = JSON.stringify(row);
  for (const secret of [POLICY.subject, PAYER.publicKey.toBase58(), quote.rulecheck.bindingDigest]) {
    assert.ok(!raw.includes(secret), `the row must not carry ${secret.slice(0, 8)}… in the clear`);
  }
});

// ---------------------------------------------------------------------------
// Reconciliation (migration 013): an unresolved row must not block a digest
// ---------------------------------------------------------------------------
const T0 = 1_790_000_000_000;
/** Past RECONCILE_STALE_SECONDS: a claim this old is not in flight. */
const STALE = 61_000;
/** Past EXPIRY_FLOOR_SECONDS: an expired blockhash is believed. */
const EXPIRED = 121_000;
const LANDED_SIG = bs58.encode(createHash("sha512").update("settle/landed").digest());
const txOf = (p: PaymentPayload) => p.payload.transaction;

/** A paid request that dies after the append mark, with its settlement possibly sent. */
async function crashAfterMark(clock: Clock) {
  const log: string[] = [];
  const mem = memoryDb(log, clock);
  const behaviour = { crash: true, outcome: SETTLED as SettleOutcome };
  const fac = mockFacilitator(log, () => {
    if (behaviour.crash) throw new Error("the process died mid-settlement");
    return behaviour.outcome;
  });
  const ch = mockChain(log, { live: true, landed: null });
  const d = deps(mem.db, fac.facilitator, SLOT, ch.chain);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  const dead = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);
  assert.equal(dead.status, 500, "the crash surfaces as a failure, not an answer");
  assert.equal(mem.payments[0].status, "claimed");
  assert.equal(mem.payments[0].record_appended, true);
  assert.ok(mem.payments[0].payment_payload, "the payload is stored with the append mark");
  behaviour.crash = false;
  const pay = (nonce: string) => handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce })), d);
  return { log, ...mem, fac, ch, pay, behaviour };
}

await test("a claim stuck by a crash stops blocking the next payer: resubmitted byte-identical, and settled", async () => {
  const clock = { t: T0 };
  const { fac, ch, pay, payments, records } = await crashAfterMark(clock);

  // Still fresh: the request that holds it may be alive, so nobody touches it.
  const early = await pay("two");
  assert.equal(early.status, 409);
  assert.equal(ch.calls.find, 0, "a claim that may be in flight is not reconciled");

  clock.t += STALE;
  const res = await pay("two");
  const body = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 200, "the digest is buyable again — the bug this exists for");
  assert.equal(body.payment, "already-settled", "the second payer is served and not charged");
  assert.equal(fac.calls.settle, 2, "the crashed attempt, then one resubmission");
  assert.deepEqual(fac.calls.settled[1], fac.calls.settled[0], "the resubmission is the stored payment, byte for byte");
  assert.equal(payments.length, 1, "the second payer's payment was never claimed");
  assert.equal(payments[0].status, "settled");
  assert.equal(records.length, 1);
});

await test("a stuck claim whose blockhash expired unseen is declined, and the next payer buys the stored record", async () => {
  const clock = { t: T0 };
  const { log, fac, ch, pay, payments, records } = await crashAfterMark(clock);
  ch.state.live = false;
  clock.t += EXPIRED;

  const res = await pay("two");
  const body = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 200);
  assert.equal(body.payment, "settled", "this payer's own payment paid for it");
  assert.equal(body.chain.seq, 1, "the record released is the one already stored");
  assert.equal(records.length, 1);
  assert.equal(payments[0].status, "declined");
  assert.equal(payments[1].status, "settled");
  assert.notEqual(txOf(fac.calls.settled[1]!), txOf(fac.calls.settled[0]!), "the settlement that paid is the new payer's");
  assert.ok(
    log.indexOf("chain.blockhashLive") < log.indexOf("chain.findPayment"),
    "expiry is read before the search, so a search after expiry is final",
  );
});

await test("an unknown settlement found on-chain is marked settled, and nothing is resubmitted", async () => {
  const log: string[] = [];
  const { db, payments } = memoryDb(log, { t: T0 });
  const { facilitator, calls } = mockFacilitator(log, () => ({ kind: "unknown", reason: "timed out" }));
  const ch = mockChain(log, { live: true, landed: { signature: LANDED_SIG, failed: false } });
  const d = deps(db, facilitator, SLOT, ch.chain);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);
  assert.equal(payments[0].status, "unknown");

  const res = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  const body = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 200);
  assert.equal(body.payment, "already-settled");
  assert.equal(calls.settle, 1, "the chain answered; the facilitator was not asked again");
  assert.equal(payments[0].status, "settled");
  assert.equal(payments[0].settle_signature, LANDED_SIG);
});

await test("a refused resubmission does not decline while the blockhash lives; the chain declines it after", async () => {
  const log: string[] = [];
  const clock = { t: T0 };
  const { db, payments } = memoryDb(log, clock);
  let outcome: SettleOutcome = { kind: "unknown", reason: "timed out" };
  const { facilitator, calls } = mockFacilitator(log, () => outcome);
  const ch = mockChain(log, { live: true, landed: null });
  const d = deps(db, facilitator, SLOT, ch.chain);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);

  // "Already processed" can come back as a refusal. It is not the chain's word.
  outcome = { kind: "declined", reason: "transaction_already_processed" };
  const waiting = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  assert.equal(waiting.status, 409);
  assert.equal(calls.settle, 2, "resubmitted once");
  assert.equal(payments[0].status, "unknown", "left open: only the chain declines");

  clock.t += EXPIRED;
  ch.state.live = false;
  outcome = SETTLED;
  const res = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  assert.equal(res.status, 200);
  assert.equal(payments[0].status, "declined");
  assert.equal(payments[1].status, "settled");
});

await test("a payment that landed and failed is declined without a resubmission", async () => {
  const log: string[] = [];
  const { db, payments } = memoryDb(log, { t: T0 });
  const { facilitator, calls } = mockFacilitator(log, () => ({ kind: "unknown", reason: "timed out" }));
  const ch = mockChain(log, { live: true, landed: { signature: LANDED_SIG, failed: true } });
  const d = deps(db, facilitator, SLOT, ch.chain);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);

  await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  assert.equal(payments[0].status, "declined");
  assert.equal(calls.settle, 2, "the original, and the second payer's own — no resubmission of the failed one");
});

await test("a stored payment that does not hash to its row is never resubmitted", async () => {
  const clock = { t: T0 };
  const { fac, pay, payments } = await crashAfterMark(clock);
  // A bug that swapped payloads: the row now carries a different transaction.
  const other = JSON.parse(Buffer.from(buildPayment(fac.calls.settled[0]!.accepted, { nonce: "swapped" }), "base64").toString("utf8"));
  (payments[0].payment_payload as PaymentPayload).payload.transaction = other.payload.transaction;
  clock.t += STALE;

  const res = await pay("three");
  assert.equal(res.status, 409, "left open rather than guessed at");
  assert.equal(fac.calls.settle, 1, "nothing was resubmitted");
  assert.equal(payments[0].status, "claimed");
});

await test("a stale claim with no append mark is released without asking the chain", async () => {
  const log: string[] = [];
  const clock = { t: T0 };
  const mem = memoryDb(log, clock);
  let die = true;
  const db: RulecheckDb = {
    ...mem.db,
    rpc(fn, params) {
      if (fn === "rulecheck_mark_appended_with_payload" && die) {
        die = false;
        throw new Error("the process died between the append and the mark");
      }
      return mem.db.rpc(fn, params);
    },
  };
  const { facilitator, calls } = mockFacilitator(log, () => SETTLED);
  const ch = mockChain(log, { live: true, landed: null });
  const d = deps(db, facilitator, SLOT, ch.chain);
  const quote = (await (await handle(post({ transaction: TX, policy: POLICY }), d)).json()) as Record<string, any>;
  const dead = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "one" })), d);
  assert.equal(dead.status, 500);
  assert.equal(mem.records.length, 1, "the record was stored");
  assert.equal(mem.payments[0].record_appended, false, "but the mark was not");

  clock.t += STALE;
  const res = await handle(post({ transaction: TX, policy: POLICY }, buildPayment(quote.accepts[0], { nonce: "two" })), d);
  const body = (await res.json()) as Record<string, any>;
  assert.equal(res.status, 200);
  assert.equal(body.chain.seq, 1, "the stored record is the one sold");
  assert.equal(mem.payments[0].status, "released");
  assert.equal(ch.calls.live + ch.calls.find, 0, "no settlement was ever submitted, so the chain has nothing to say");
  assert.equal(calls.settle, 1, "one settlement, the second payer's");
});

console.log(`\nrulecheck route tests: ${held} held\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

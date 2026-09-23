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
import type { Facilitator, PaymentRequirements, SettleOutcome } from "./rulecheck-payment";
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
  created_at: number;
}
const LIVE = ["claimed", "settled", "unknown"];

function memoryDb(log: string[]) {
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
          created_at: Date.now(),
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

      if (fn === "rulecheck_finish_payment") {
        const row = payments.find((r) => r.payment_key === p.p_payment_key);
        const to = p.p_status as PaymentRow["status"];
        if (row && (row.status === "claimed" || (row.status === "unknown" && (to === "settled" || to === "declined")))) {
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
  const calls = { verify: 0, settle: 0 };
  const facilitator: Facilitator = {
    async verify() {
      log.push("facilitator.verify");
      calls.verify++;
      return { isValid: true, payer: PAYER.publicKey.toBase58() };
    },
    async settle(_payload, _requirements, proof) {
      log.push("facilitator.settle");
      calls.settle++;
      assert.ok(proof && typeof proof.digest === "string", "a settlement must carry its proof of a stored record");
      assert.ok(
        log.indexOf("rulecheck_append_record") >= 0 && log.indexOf("rulecheck_append_record") < log.lastIndexOf("facilitator.settle"),
        "the record must be appended before a settlement is submitted",
      );
      return outcome();
    },
  };
  return { facilitator, calls };
}

function deps(db: RulecheckDb, facilitator: Facilitator, slot = SLOT): RouteDeps {
  return {
    ports: {
      facilitator,
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
      "rulecheck_mark_appended",
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

console.log(`\nrulecheck route tests: ${held} held\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

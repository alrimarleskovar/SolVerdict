// SPDX-License-Identifier: Apache-2.0
/**
 * The record store and the record signing key.
 *
 * NO DATABASE, AND NO RULECHECK CORE. The client is a fake implementing what
 * migration 011's `rulecheck_append_record` promises — idempotent by lookup
 * key, refusing an append that names a stale head — so the retry path and the
 * chain linkage are exercised here rather than discovered in production.
 *
 * The records are stand-ins rather than real ones, deliberately: the store is
 * indifferent to what a record says, and importing the core would pull
 * env/txparse into the web module graph, which rulecheck/rulecheck.test.ts
 * would then flag as the two pipelines widening their contact. Its content is
 * exercised where it belongs, in the core's own suite.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { CHAIN_GENESIS, nextChainHash, replayChain } from "../../rulecheck/chain";
import { publicKeyForSeed, signEnvelope, type RecordEnvelope } from "../../rulecheck/envelope";
import type { RecordKey } from "../../rulecheck/keys";
import { lookupKeyFor } from "../../rulecheck/seal";
import { recordSigner, RecordSigningUnavailable, signerStatus } from "./rulecheck-key";
import { getRecord, putRecord, RecordIntegrityError, type RulecheckDb } from "./rulecheck-store";

const SEED = createHash("sha256").update("store-test/record-key").digest();
const OTHER_SEED = createHash("sha256").update("store-test/other-key").digest();
const KEY_ID = "rk-store-test";
const PUBKEY = publicKeyForSeed(SEED);
const KEYS: RecordKey[] = [{ keyId: KEY_ID, publicKey: PUBKEY, from: "2026-09-20" }];

const hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const DIGEST = hex("binding/one");
const OTHER_DIGEST = hex("binding/two");
const FOREIGN_RECORD_SHA = hex("some other record");

/**
 * A stand-in record, with a marker to prove nothing readable reaches a column.
 * It carries `binding.slot` because the envelope refuses to sign a record
 * without one (§7) — the store never reads it, and the slot stays inside the
 * sealed blob rather than becoming a column of its own.
 */
const MARKER = "SUBJECT-MARKER-3Qx";
const record = (n: number) => ({
  format: "solverdict-rulecheck-record/0",
  n,
  binding: { slot: String(364_000_000 + n) },
  policy: { subject: MARKER },
});

const sign = <R>(r: R, issuedAt: string, seed: Uint8Array = SEED): RecordEnvelope<R> =>
  signEnvelope(r, { keyId: KEY_ID, seed, issuedAt });

interface FakeRow {
  seq: number;
  lookup_key: string;
  record_sha256: string;
  key_id: string;
  sealed: string;
  prev_chain_hash: string;
  chain_hash: string;
  appended_at: string;
}

/** The fake client. `raceOnce` makes another append land first, exactly once. */
function fakeDb(opts: { raceOnce?: boolean } = {}) {
  const rows: FakeRow[] = [];
  let calls = 0;
  let raced = false;
  const head = () => (rows.length > 0 ? rows[rows.length - 1]!.chain_hash : CHAIN_GENESIS);

  const db: RulecheckDb = {
    rpc(fn, params) {
      calls++;
      assert.equal(fn, "rulecheck_append_record", "the store must call the migration's function");
      const p = params as Record<string, string>;

      const existing = rows.find((r) => r.lookup_key === p.p_lookup_key);
      if (existing) return Promise.resolve({ data: [{ status: "exists", ...existing }], error: null });

      if (opts.raceOnce && !raced) {
        raced = true;
        const prev = head();
        rows.push({
          seq: rows.length + 1,
          lookup_key: hex("someone else's digest"),
          record_sha256: FOREIGN_RECORD_SHA,
          key_id: KEY_ID,
          sealed: "not this test's",
          prev_chain_hash: prev,
          chain_hash: nextChainHash(prev, FOREIGN_RECORD_SHA),
          appended_at: new Date().toISOString(),
        });
      }

      if (head() !== p.p_prev_chain_hash) {
        // What the function returns when nothing was written: the real head,
        // and NULL in every other column.
        return Promise.resolve({
          data: [
            {
              status: "head-moved",
              seq: null,
              record_sha256: null,
              key_id: null,
              sealed: null,
              prev_chain_hash: null,
              chain_hash: head(),
              appended_at: null,
            },
          ],
          error: null,
        });
      }

      const row: FakeRow = {
        seq: rows.length + 1,
        lookup_key: p.p_lookup_key!,
        record_sha256: p.p_record_sha256!,
        key_id: p.p_key_id!,
        sealed: p.p_sealed!,
        prev_chain_hash: p.p_prev_chain_hash!,
        chain_hash: p.p_chain_hash!,
        appended_at: new Date().toISOString(),
      };
      rows.push(row);
      return Promise.resolve({ data: [{ status: "appended", ...row }], error: null });
    },

    from(table) {
      assert.equal(table, "rulecheck_records", "the store must not name another table");
      return {
        select: () => ({
          eq: (column: string, value: string) => ({
            maybeSingle: () => {
              assert.equal(column, "lookup_key", "a read must be addressed by lookup key and nothing else");
              return Promise.resolve({ data: rows.find((r) => r.lookup_key === value) ?? null, error: null });
            },
          }),
        }),
      };
    },
  };

  return { db, rows, calls: () => calls };
}

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

// --- the round trip ---------------------------------------------------------
test("a sealed record comes back exactly as it was signed", async () => {
  const { db, rows } = fakeDb();
  const envelope = sign(record(1), "2026-09-20T10:00:00.000Z");

  const put = await putRecord(DIGEST, envelope, { db, keys: KEYS });
  assert.equal(put.appended, true);
  assert.equal(put.stored.seq, 1);
  assert.equal(put.stored.prevChainHash, CHAIN_GENESIS);
  assert.equal(put.stored.chainHash, nextChainHash(CHAIN_GENESIS, envelope.recordSha256));
  assert.deepEqual(put.stored.envelope, envelope);

  const got = await getRecord(DIGEST, { db, keys: KEYS });
  assert.deepEqual(got?.envelope, envelope, "the stored envelope must survive sealing byte for byte");
  assert.equal(rows.length, 1);
});

test("the same digest is the same claim: a repeat keeps the first record", async () => {
  const { db, rows } = fakeDb();
  const first = sign(record(1), "2026-09-20T10:00:00.000Z");
  const second = sign(record(1), "2026-09-20T18:30:00.000Z");
  assert.notDeepEqual(first, second, "the two envelopes must differ, or this proves nothing");

  await putRecord(DIGEST, first, { db, keys: KEYS });
  const again = await putRecord(DIGEST, second, { db, keys: KEYS });

  assert.equal(again.appended, false);
  assert.equal(again.stored.envelope.issuedAt, first.issuedAt, "the first issuance is what a reader must see");
  assert.equal(rows.length, 1, "a repeat must not append a second row");
});

test("an append that loses a race relinks onto the new head", async () => {
  const { db, rows, calls } = fakeDb({ raceOnce: true });
  const envelope = sign(record(1), "2026-09-20T10:00:00.000Z");

  const put = await putRecord(DIGEST, envelope, { db, keys: KEYS });
  assert.equal(put.appended, true);
  assert.ok(calls() >= 2, "the first attempt must have been refused and retried");
  assert.equal(rows.length, 2);

  const ours = rows.find((r) => r.lookup_key === lookupKeyFor(DIGEST))!;
  const foreign = rows.find((r) => r.record_sha256 === FOREIGN_RECORD_SHA)!;
  assert.equal(ours.prev_chain_hash, foreign.chain_hash, "our row must link onto the row that landed first");

  // And the chain the two rows form is the one a third party would recompute.
  const replayed = replayChain(
    rows.map((r) => ({ recordSha256: r.record_sha256, prevChainHash: r.prev_chain_hash, chainHash: r.chain_hash })),
  );
  assert.equal(replayed, ours.chain_hash);
});

// --- addressable, not enumerable -------------------------------------------
test("a digest that was never stored answers null, not an error", async () => {
  const { db } = fakeDb();
  assert.equal(await getRecord(DIGEST, { db, keys: KEYS }), null);

  await putRecord(DIGEST, sign(record(1), "2026-09-20T10:00:00.000Z"), { db, keys: KEYS });
  assert.equal(await getRecord(OTHER_DIGEST, { db, keys: KEYS }), null, "another digest must not reach this row");
});

test("no column carries the digest, the record, or anything readable from it", async () => {
  const { db, rows } = fakeDb();
  const envelope = sign(record(1), "2026-09-20T10:00:00.000Z");
  await putRecord(DIGEST, envelope, { db, keys: KEYS });

  const row = rows[0]!;
  const asText = JSON.stringify(row);
  assert.ok(!asText.includes(DIGEST), "the digest is the key to the row; storing it would hand over every record");
  assert.ok(!asText.includes(MARKER), "the record's own content must not be legible in any column");
  assert.ok(!asText.includes(envelope.signature), "the envelope travels sealed, signature included");
  assert.equal(row.lookup_key, lookupKeyFor(DIGEST));
  // What IS in the clear, and nothing else: hashes, the public key id, the
  // chain links, the append time.
  assert.deepEqual(Object.keys(row).sort(), [
    "appended_at", "chain_hash", "key_id", "lookup_key", "prev_chain_hash", "record_sha256", "sealed", "seq",
  ]);
});

// --- a row that cannot be trusted is refused, never served ------------------
test("a tampered row is refused rather than returned", async () => {
  const { db, rows } = fakeDb();
  await putRecord(DIGEST, sign(record(1), "2026-09-20T10:00:00.000Z"), { db, keys: KEYS });

  const original = rows[0]!.sealed;
  rows[0]!.sealed = Buffer.from(
    (() => {
      const raw = Buffer.from(original, "base64");
      raw[raw.length - 1] ^= 0x01;
      return raw;
    })(),
  ).toString("base64");

  await assert.rejects(() => getRecord(DIGEST, { db, keys: KEYS }), RecordIntegrityError);
  rows[0]!.sealed = original;

  // A row whose cleartext digest disagrees with the sealed envelope is refused
  // too: the chain commits to that column, so a swapped one would break it.
  rows[0]!.record_sha256 = FOREIGN_RECORD_SHA;
  await assert.rejects(() => getRecord(DIGEST, { db, keys: KEYS }), /names record/);
});

test("a record signed under a key the registry does not carry is refused", async () => {
  const { db } = fakeDb();
  await putRecord(DIGEST, sign(record(1), "2026-09-20T10:00:00.000Z"), { db, keys: KEYS });
  await assert.rejects(() => getRecord(DIGEST, { db, keys: [] }), /registry does not carry/);
  await assert.rejects(
    () => getRecord(DIGEST, { db, keys: [{ ...KEYS[0]!, publicKey: publicKeyForSeed(OTHER_SEED) }] }),
    /not this key's/,
  );
});

// --- the signing key --------------------------------------------------------
/** The spelling keygen prints, and therefore the only one the loader accepts. */
const seedBase58 = bs58.encode(SEED);
const otherSeedBase58 = bs58.encode(OTHER_SEED);

test("the signer signs as the registry says it does", () => {
  const env = { RULECHECK_RECORD_KEY_ID: KEY_ID, RULECHECK_RECORD_SIGNING_SEED: seedBase58 };
  const signer = recordSigner(env, KEYS);
  assert.equal(signer.keyId, KEY_ID);
  assert.equal(signer.publicKey, PUBKEY);

  const envelope = signer.sign(record(1), new Date("2026-09-20T10:00:00.000Z"));
  assert.equal(envelope.keyId, KEY_ID);
  assert.deepEqual(envelope, sign(record(1), "2026-09-20T10:00:00.000Z"));

  const status = signerStatus(env, KEYS);
  assert.equal(status.ready, true);
  assert.ok(status.detail.includes(PUBKEY));
  assert.ok(!status.detail.includes(seedBase58), "a status line must never carry the seed");
});

test("every way of misconfiguring the key is a refusal before anything is signed", () => {
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ RULECHECK_RECORD_SIGNING_SEED: seedBase58 }, /RULECHECK_RECORD_KEY_ID is not set/],
    [{ RULECHECK_RECORD_KEY_ID: KEY_ID }, /RULECHECK_RECORD_SIGNING_SEED is not set/],
    [{ RULECHECK_RECORD_KEY_ID: "rk-absent", RULECHECK_RECORD_SIGNING_SEED: seedBase58 }, /not in the published registry/],
    [{ RULECHECK_RECORD_KEY_ID: KEY_ID, RULECHECK_RECORD_SIGNING_SEED: "not-a-seed" }, /seed is unusable/],
    [
      { RULECHECK_RECORD_KEY_ID: KEY_ID, RULECHECK_RECORD_SIGNING_SEED: otherSeedBase58 },
      /the registry lists/,
    ],
  ];
  for (const [env, pattern] of cases) {
    assert.throws(() => recordSigner(env, KEYS), RecordSigningUnavailable);
    assert.throws(() => recordSigner(env, KEYS), pattern);
    assert.equal(signerStatus(env, KEYS).ready, false);
  }
});

test("a signing key that is also a payment destination cannot sign (§7)", () => {
  for (const name of ["SOLVERDICT_PAYMENT_WALLET", "RULECHECK_PAYMENT_WALLET"]) {
    const env = { RULECHECK_RECORD_KEY_ID: KEY_ID, RULECHECK_RECORD_SIGNING_SEED: seedBase58, [name]: PUBKEY };
    assert.throws(() => recordSigner(env, KEYS), /not the payment-receiving key/);
  }
  // A different payment wallet is no obstacle, which is the point of the check.
  const fine = {
    RULECHECK_RECORD_KEY_ID: KEY_ID,
    RULECHECK_RECORD_SIGNING_SEED: seedBase58,
    SOLVERDICT_PAYMENT_WALLET: publicKeyForSeed(OTHER_SEED),
  };
  assert.equal(recordSigner(fine, KEYS).publicKey, PUBKEY);
});

async function main() {
  let passed = 0;
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(`FAIL: ${name}\n  ${(err as Error).message}`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    console.error(`${failures.length} rulecheck store test(s) did not hold (${passed} held)`);
    process.exit(1);
  }
  console.log(`rulecheck store tests: ${passed} held`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

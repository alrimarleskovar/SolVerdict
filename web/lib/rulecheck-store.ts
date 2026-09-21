// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: the store for issued rulecheck records.
 *
 * ADDRESSABLE, NOT ENUMERABLE. A record is readable by whoever holds its
 * binding digest and by nobody else. There is no listing call, no query by
 * subject, payer or date, and no second key that opens a row: the row id is
 * `sha256(domain ‖ digest)` and the contents are sealed under a key derived
 * from the digest itself (rulecheck/seal.ts). Reading the whole table yields
 * the count of records and their append times, and nothing about whose they
 * are — including to us. This is deliberate and it is a departure from
 * RULECHECK.md §8(e), whose "published by design" is being narrowed to
 * "generated and addressable by design": someone who pays to learn that their
 * own transaction is over a limit should not have that become world-readable
 * the instant they pay. The document is amended to match before this ships.
 *
 * WHAT THE TABLE HOLDS IN THE CLEAR, AND WHY EACH ONE IS THERE. The record
 * digest, the signing key id, the two chain links and the append time. The
 * digest is a hash, so it identifies nothing on its own; the key id is already
 * public (rulecheck/keys.ts); the chain links are what make the set
 * tamper-evident (rulecheck/chain.ts), which cannot work if they are sealed.
 *
 * WHY IT SHARES POSTGRES WITH THE BENCHMARK SIDE AND NOTHING ELSE. §8(e)
 * requires that the two pipelines do not meet. They meet here at exactly one
 * module — `./supabase`, the client factory — because the service-role key must
 * be read in exactly one place (lib/server-only-secrets.test.ts §3), and a
 * second factory would weaken the guarantee that matters more. Everything above
 * that is separate: its own table, its own prefix, no foreign key, no shared
 * row, and no import of anything that computes or renders a benchmark result.
 * rulecheck/rulecheck.test.ts holds that line mechanically.
 *
 * IDEMPOTENT BY DIGEST. The same bytes, policy and slot are the same claim, so
 * a repeat request returns the record already held rather than issuing a second
 * one. The first envelope wins: its `issuedAt` is when this claim was first
 * made, which is what a reader judging staleness (§7) needs to see.
 */
import { CHAIN_GENESIS, nextChainHash } from "../../rulecheck/chain";
import { verifyEnvelope, type RecordEnvelope } from "../../rulecheck/envelope";
import { keyById, RECORD_KEYS, type RecordKey } from "../../rulecheck/keys";
import { lookupKeyFor, seal, unseal } from "../../rulecheck/seal";
import { supabaseAdmin } from "./supabase";

/** Minimal shape of the client this module needs (mirrors payment.ts's RpcLike). */
export interface RulecheckDb {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
}

export interface StoredRecord<R = unknown> {
  envelope: RecordEnvelope<R>;
  /** Position in the append-only chain, from 1. */
  seq: number;
  chainHash: string;
  prevChainHash: string;
  /** When the row was appended, as the database stamped it. */
  appendedAt: string;
}

/** Raised when a row exists but cannot be trusted as issued by us. */
export class RecordIntegrityError extends Error {
  constructor(reason: string) {
    super(`stored record is unusable: ${reason}`);
    this.name = "RecordIntegrityError";
  }
}

const SELECTED = "seq, record_sha256, key_id, sealed, prev_chain_hash, chain_hash, appended_at";

/**
 * What a call may substitute: the client, and the registry a stored envelope is
 * verified against.
 *
 * The registry is a parameter rather than a global for the same reason the RPC
 * client is one — a suite has to be able to exercise the verification path
 * without holding the deployment's key — and because a reader checking old
 * records may legitimately want to pin the registry they verify against rather
 * than take whichever one ships today.
 */
export interface StoreOptions {
  db?: RulecheckDb;
  keys?: readonly RecordKey[];
}

/** How many times an append retries when a concurrent append moved the head. */
const APPEND_ATTEMPTS = 4;

/**
 * The head this process last saw, as the first guess for the next append.
 *
 * Only a guess: the database refuses an append whose named head is stale and
 * returns the real one, so a wrong value here costs one extra round trip and
 * can never produce a broken chain. A warm function therefore appends in one
 * call, and a cold one in two.
 */
let lastKnownHead: string | null = null;

function db(given?: RulecheckDb): RulecheckDb {
  return given ?? (supabaseAdmin() as unknown as RulecheckDb);
}

interface RawRow {
  seq: number | string;
  record_sha256: string;
  key_id: string;
  sealed: string;
  prev_chain_hash: string;
  chain_hash: string;
  appended_at: string;
}

function asRow(value: unknown): RawRow {
  const row = value as Partial<RawRow> | null;
  if (!row || typeof row !== "object" || typeof row.sealed !== "string" || typeof row.chain_hash !== "string") {
    throw new RecordIntegrityError("the row is missing the columns this store wrote");
  }
  return row as RawRow;
}

/**
 * Opens a row: unseals it, then checks the envelope against the published
 * registry before it is handed to anyone.
 *
 * A store that served a row it could not verify would be trusting its own
 * database to be the authority on what we signed, which is the one thing the
 * signature exists to avoid.
 */
function openRow(bindingDigest: string, row: RawRow, keys: readonly RecordKey[]): StoredRecord {
  let envelope: RecordEnvelope;
  try {
    envelope = JSON.parse(unseal(bindingDigest, row.sealed)) as RecordEnvelope;
  } catch (err) {
    throw new RecordIntegrityError(`it does not open under its own digest (${err instanceof Error ? err.message : String(err)})`);
  }

  if (envelope.recordSha256 !== row.record_sha256) {
    throw new RecordIntegrityError(
      `the sealed envelope names record ${envelope.recordSha256}, the row names ${row.record_sha256}`,
    );
  }

  const key = keyById(envelope.keyId, keys);
  if (!key) throw new RecordIntegrityError(`it names key id ${envelope.keyId}, which the registry does not carry`);

  const verified = verifyEnvelope(envelope, key.publicKey);
  if (!verified.ok) throw new RecordIntegrityError(verified.reason);

  return {
    envelope,
    seq: Number(row.seq),
    chainHash: row.chain_hash,
    prevChainHash: row.prev_chain_hash,
    appendedAt: row.appended_at,
  };
}

export interface PutResult {
  stored: StoredRecord;
  /** False when this digest was already held — the envelope returned is the first one. */
  appended: boolean;
}

/**
 * Seals a signed envelope and appends it to the chain.
 *
 * The chain link is computed here rather than in SQL so that a third party can
 * recompute it from the published core (rulecheck/chain.ts); the database only
 * enforces that an append names the current head.
 */
export async function putRecord<R>(
  bindingDigest: string,
  envelope: RecordEnvelope<R>,
  opts: StoreOptions = {},
): Promise<PutResult> {
  const client = db(opts.db);
  const keys = opts.keys ?? RECORD_KEYS;
  const lookupKey = lookupKeyFor(bindingDigest);
  const sealed = seal(bindingDigest, JSON.stringify(envelope));

  let prev = lastKnownHead ?? CHAIN_GENESIS;

  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
    const { data, error } = await client.rpc("rulecheck_append_record", {
      p_lookup_key: lookupKey,
      p_record_sha256: envelope.recordSha256,
      p_key_id: envelope.keyId,
      p_sealed: sealed,
      p_prev_chain_hash: prev,
      p_chain_hash: nextChainHash(prev, envelope.recordSha256),
    });
    if (error) throw new Error(`could not append the record: ${error.message}`);

    const rows = Array.isArray(data) ? data : [data];
    const first = rows[0] as { status?: string } | null;
    if (!first || typeof first.status !== "string") {
      throw new RecordIntegrityError("the append call answered without a status");
    }

    if (first.status === "head-moved") {
      // Another append landed first, so nothing was written and most columns
      // come back NULL. Only the head is meaningful here — reading this answer
      // as a row would refuse a perfectly ordinary race.
      const head = (first as { chain_hash?: unknown }).chain_hash;
      if (typeof head !== "string" || !/^[0-9a-f]{64}$/.test(head)) {
        throw new RecordIntegrityError("the append call reported a moved head without naming it");
      }
      prev = head;
      lastKnownHead = head;
      continue;
    }

    const row = asRow(first);
    lastKnownHead = row.chain_hash;
    return { stored: openRow(bindingDigest, row, keys), appended: first.status === "appended" };
  }

  throw new Error(`could not append the record: the chain head moved ${APPEND_ATTEMPTS} times running`);
}

/**
 * The record for a digest, or null if none is held.
 *
 * Null is the only answer for "not here", and it is indistinguishable from
 * "never existed" by design: a caller who does not hold the digest cannot ask
 * the question at all, and one who does learns only about their own record.
 */
export async function getRecord(bindingDigest: string, opts: StoreOptions = {}): Promise<StoredRecord | null> {
  const { data, error } = await db(opts.db)
    .from("rulecheck_records")
    .select(SELECTED)
    .eq("lookup_key", lookupKeyFor(bindingDigest))
    .maybeSingle();

  if (error) throw new Error(`could not read the record: ${error.message}`);
  if (!data) return null;
  return openRow(bindingDigest, asRow(data), opts.keys ?? RECORD_KEYS);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The signed envelope around a rulecheck record (RULECHECK.md §7).
 *
 * §7 requires that "the record is signed with a key that is not the
 * payment-receiving key", so a record leaves this process wrapped in an
 * envelope naming which key signed it, when it was issued, and the digest of
 * the record those two commit to.
 *
 * WHAT THE SIGNATURE IS FOR, AND WHAT IT IS NOT FOR. It is attribution, not
 * truth. What a rule says about a set of bytes is recomputable by anyone
 * holding the bytes, the policy and the slot — that is Option A of §4, and it
 * needs no key at all. The signature answers a different question: did this
 * project issue this exact record? A reader who distrusts the signature can
 * still recompute the record; a reader who distrusts the record can still check
 * the signature. Neither leans on the other, which is why a leaked signing key
 * cannot make a wrong record right.
 *
 * WHAT THE ENVELOPE MAY NOT CARRY. §7 binds a record to the message bytes, the
 * policy id, the policy version digest and the slot — "and to nothing else. Not
 * the caller, not a session, not an API key, not the payer." The envelope obeys
 * the same rule: no payer, no payment signature, no price, no request metadata,
 * no caller identifier. A record that named its payer would be a statement
 * about a party, which is the one thing §2 says this surface never makes.
 *
 * TWO ADDITIONS, BOTH ABOUT TIME. `issuedAt` is here because §7 requires that
 * "a stale record must read as stale": a reader cannot judge the age of a
 * record that does not say when it was issued. `slot` is lifted out of the
 * record and signed alongside it because §7 gives slot binding "equal weight to
 * byte binding", and a reader should not have to understand the record's schema
 * to see which chain state it speaks about.
 *
 * WHAT THE SLOT DOES AND DOES NOT DO AGAINST A STOLEN KEY. Both values are
 * asserted by whoever holds the key, so neither stops a forgery on its own: a
 * thief who wants a record dated last March writes last March's slot and last
 * March's issuedAt, and the signature is valid. What signing the pair together
 * removes is the thief's freedom to mix them. A genuine record is issued within
 * seconds of its slot — that is the freshness window §7 demands of this surface
 * — so any envelope whose slot and issuedAt disagree by more than that window is
 * refutable by anyone with an RPC connection and `slotSkewSeconds` below, with
 * no access to us and no knowledge of the record format. What remains possible
 * is a *coherent* forgery, with both values moved together; only the chain
 * (chain.ts) and an anchor published before the claimed date rule that out.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import bs58 from "bs58";
import { forbiddenWordsIn } from "./vocabulary.js";

export const ENVELOPE_FORMAT = "solverdict-rulecheck-envelope/0";

/** 32 raw bytes, as base58 — the same spelling Solana uses for a public key. */
export type Base58Key = string;

export interface RecordEnvelope<R = unknown> {
  format: typeof ENVELOPE_FORMAT;
  /** Lowercase hex SHA-256 over the record's canonical JSON. */
  recordSha256: string;
  /** Which entry of the published registry signed this (keys.ts). */
  keyId: string;
  /** ISO 8601 with milliseconds, UTC. When the record was issued. */
  issuedAt: string;
  /** The slot the record speaks about, as a u64 decimal string. Lifted from `record.binding.slot`. */
  slot: string;
  /** Base58 Ed25519 signature over the signed view (see `signedView`). */
  signature: string;
  record: R;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const HEX32 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const U64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX = 2n ** 64n - 1n;

/**
 * The slot a record speaks about, read out of the record rather than supplied
 * beside it.
 *
 * DERIVED, NOT SUPPLIED. If the envelope took the slot as a parameter, an envelope
 * could name one slot while the record it carries names another, and both halves
 * would be correctly signed. Reading it from the record makes that contradiction
 * unconstructible here, and `verifyEnvelope` re-reads it so an envelope
 * assembled by hand cannot introduce it either.
 *
 * A record with no slot is refused rather than signed without one: §7 binds to
 * the slot, so a record that does not carry one is not a record this surface
 * issues.
 */
export function slotOf(record: unknown): string {
  const binding = (record as { binding?: { slot?: unknown } } | null | undefined)?.binding;
  const slot = binding?.slot;
  if (typeof slot !== "string" || !U64_DECIMAL.test(slot) || BigInt(slot) > U64_MAX) {
    throw new Error("a record must carry binding.slot as a u64 decimal string — §7 binds the record to its slot");
  }
  return slot;
}

/**
 * Serialises a value with object keys sorted, at every depth.
 *
 * DELIBERATELY DUPLICATED. `issuance/derive.ts` carries the same few lines, and
 * importing them is exactly what rulecheck.test.ts forbids: nothing in
 * rulecheck/ may reach the benchmark side, and a shared helper is a hop like
 * any other. One small function is the cheaper half of that trade.
 *
 * Arrays keep their order — order is meaningful in a list and incidental in an
 * object.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

/** Lowercase hex SHA-256 over a record's canonical JSON. */
export function recordDigest(record: unknown): string {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest("hex");
}

/**
 * The bytes the signature covers: the envelope without its signature and
 * without the record itself, which enters through `recordSha256`.
 *
 * Signing a digest rather than the record keeps the signed input a fixed few
 * hundred bytes whatever the record's size, and a reader recomputes the digest
 * from the record it holds — so substituting a different record under the same
 * signature is caught by the digest comparison, not left to the signature.
 */
export function signedView(parts: Pick<RecordEnvelope, "format" | "issuedAt" | "keyId" | "recordSha256" | "slot">): Buffer {
  return Buffer.from(
    canonicalJson({
      format: parts.format,
      issuedAt: parts.issuedAt,
      keyId: parts.keyId,
      recordSha256: parts.recordSha256,
      slot: parts.slot,
    }),
    "utf8",
  );
}

// An Ed25519 key in DER, which is what node:crypto accepts. The prefixes are
// the fixed ASN.1 headers for the curve: everything before the raw 32 bytes.
// Written out rather than pulled from a dependency so that this module needs
// nothing but node:crypto and a base58 codec — `keyFromSeed` is cross-checked
// against @solana/web3.js in the test suite, where that dependency is free.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function seedBytes(seed: Uint8Array | string): Buffer {
  const raw = typeof seed === "string" ? Buffer.from(bs58.decode(seed)) : Buffer.from(seed);
  if (raw.length !== 32) throw new Error(`an Ed25519 seed is 32 bytes, got ${raw.length}`);
  return raw;
}

function privateKeyFrom(seed: Uint8Array | string) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seedBytes(seed)]), format: "der", type: "pkcs8" });
}

function publicKeyFrom(base58Key: Base58Key) {
  const raw = Buffer.from(bs58.decode(base58Key));
  if (raw.length !== 32) throw new Error(`an Ed25519 public key is 32 bytes, got ${raw.length}`);
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** The base58 public key a seed signs under. */
export function publicKeyForSeed(seed: Uint8Array | string): Base58Key {
  const der = createPublicKey(privateKeyFrom(seed)).export({ format: "der", type: "spki" });
  return bs58.encode(Buffer.from(der).subarray(SPKI_PREFIX.length));
}

export interface SignOptions {
  /** The registry entry this deployment signs as. */
  keyId: string;
  /** 32-byte Ed25519 seed. Secret, and never part of the envelope. */
  seed: Uint8Array | string;
  /** Defaults to now. Supplied by tests so an envelope can be reproduced. */
  issuedAt?: Date | string;
}

/** Wraps a record in a signed envelope. Refuses rather than issue a malformed one. */
export function signEnvelope<R>(record: R, opts: SignOptions): RecordEnvelope<R> {
  if (!KEY_ID.test(opts.keyId)) {
    throw new Error(`keyId "${opts.keyId}" must be 1–32 characters of a-z, 0-9, '.', '_' or '-'`);
  }
  // A key id travels into every record's envelope and onto every surface that
  // renders one, so §1's closed vocabulary reaches it, exactly as it reaches a
  // policy id (policy.ts).
  const words = forbiddenWordsIn(opts.keyId);
  if (words.length > 0) {
    throw new Error(`keyId "${opts.keyId}" uses words outside the rulecheck vocabulary: ${words.join(", ")}`);
  }

  const issuedAt =
    opts.issuedAt === undefined
      ? new Date().toISOString()
      : typeof opts.issuedAt === "string"
        ? opts.issuedAt
        : opts.issuedAt.toISOString();
  if (!ISO_MS.test(issuedAt)) throw new Error(`issuedAt "${issuedAt}" must be ISO 8601 UTC with milliseconds`);

  const slot = slotOf(record);
  const digest = recordDigest(record);
  const view = signedView({ format: ENVELOPE_FORMAT, issuedAt, keyId: opts.keyId, recordSha256: digest, slot });

  return {
    format: ENVELOPE_FORMAT,
    recordSha256: digest,
    keyId: opts.keyId,
    issuedAt,
    slot,
    signature: bs58.encode(sign(null, view, privateKeyFrom(opts.seed))),
    record,
  };
}

/**
 * Checks an envelope against a public key the caller resolved from the
 * registry. Non-throwing: a reader needs the reason, and a store that reads a
 * row it cannot verify must be able to refuse rather than crash.
 *
 * Both halves are checked, in this order: the record still hashes to the digest
 * the signature covers, and the signature is that key's over the signed view.
 * Checking only the second would accept any record swapped in under a valid
 * signature.
 */
export function verifyEnvelope(envelope: RecordEnvelope, publicKey: Base58Key): VerifyResult {
  if (envelope.format !== ENVELOPE_FORMAT) return { ok: false, reason: `unknown envelope format ${envelope.format}` };
  if (typeof envelope.recordSha256 !== "string" || !HEX32.test(envelope.recordSha256)) {
    return { ok: false, reason: "recordSha256 must be 64 lowercase hex characters" };
  }
  if (typeof envelope.keyId !== "string" || !KEY_ID.test(envelope.keyId)) {
    return { ok: false, reason: "keyId is not well formed" };
  }
  if (typeof envelope.issuedAt !== "string" || !ISO_MS.test(envelope.issuedAt)) {
    return { ok: false, reason: "issuedAt is not ISO 8601 UTC with milliseconds" };
  }

  // The envelope's slot must be the record's own. Checked before the signature
  // so that a hand-assembled envelope naming one slot over a record naming
  // another is refused for the contradiction rather than for a bad signature —
  // the reason a reader needs is which two numbers disagree.
  let recordSlot: string;
  try {
    recordSlot = slotOf(envelope.record);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (envelope.slot !== recordSlot) {
    return { ok: false, reason: `the envelope names slot ${envelope.slot}, the record it carries names ${recordSlot}` };
  }

  const digest = recordDigest(envelope.record);
  if (digest !== envelope.recordSha256) {
    return { ok: false, reason: `the record hashes to ${digest}, not to the ${envelope.recordSha256} the signature covers` };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(bs58.decode(envelope.signature));
  } catch {
    return { ok: false, reason: "signature is not base58" };
  }
  if (signature.length !== 64) return { ok: false, reason: `an Ed25519 signature is 64 bytes, got ${signature.length}` };

  let key;
  try {
    key = publicKeyFrom(publicKey);
  } catch (err) {
    return { ok: false, reason: `public key is unusable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const view = signedView(envelope);
  return verify(null, view, key, signature)
    ? { ok: true }
    : { ok: false, reason: "the signature is not this key's over this envelope" };
}

/** A slot the caller observed, and when they observed it. */
export interface SlotReference {
  slot: bigint | string;
  at: Date | string;
}

/**
 * Seconds between when an envelope says it was issued and when the slot it
 * names occurred, measured against a slot the caller observed.
 *
 * A genuine record is issued within the freshness window of its slot, so the
 * answer is small and positive. A large positive answer means the record speaks
 * about state much older than its issuance — the shape a mixed-up forgery takes,
 * and the shape §7's "a stale record must read as stale" is about. A negative
 * answer means the envelope claims a slot that had not happened when it says it
 * was issued.
 *
 * THE CALLER SUPPLIES THE OBSERVATION. This function does no chain read and
 * holds no opinion about the current slot: §4's Option A keeps chain state off
 * this path, and a constant embedded here would be a lie within a year. `slotMs`
 * is nominal, so the estimate is only worth trusting near the reference — which
 * is the only place a seconds-scale window is being checked anyway. Over months
 * the accumulated drift is larger than any window this surface uses.
 */
export function slotSkewSeconds(
  envelope: Pick<RecordEnvelope, "issuedAt" | "slot">,
  reference: SlotReference,
  slotMs = 400,
): number {
  const envelopeSlot = BigInt(slotOf({ binding: { slot: envelope.slot } }));
  const refSlot = BigInt(reference.slot);
  const refAt = (reference.at instanceof Date ? reference.at : new Date(reference.at)).getTime();
  if (!Number.isFinite(refAt)) throw new Error("the reference observation time is not a date");
  const issued = new Date(envelope.issuedAt).getTime();
  if (!Number.isFinite(issued)) throw new Error("the envelope's issuedAt is not a date");
  const slotAt = refAt + Number(envelopeSlot - refSlot) * slotMs;
  return (issued - slotAt) / 1000;
}

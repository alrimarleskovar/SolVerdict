// SPDX-License-Identifier: Apache-2.0
/**
 * The published registry of record signing keys.
 *
 * A record's envelope names a `keyId`, never a key (envelope.ts). This file is
 * what a reader resolves that id against, and it is committed rather than
 * served so that the mapping from id to public key has the repository's history
 * behind it: a key swapped for another is a visible change to a tracked file,
 * not a silent change to a response.
 *
 * ROTATION. Entries accumulate and are never edited away. A rotation adds a new
 * entry with its own id and `from`, sets `until` on the outgoing one, and moves
 * two environment values in the deployment. Old records keep verifying, because
 * each names the id it was signed under — which is the whole reason the id is in
 * the envelope instead of the key itself.
 *
 * WHAT A LEAKED SIGNING KEY BUYS AN ATTACKER, AND WHAT IT DOES NOT. It buys
 * records that appear to be ours for bytes of their choosing. It does not buy a
 * wrong answer about any real transaction: what a rule says about bytes is
 * recomputable by anyone holding them (§4, Option A), so a forged record is
 * refuted by rerunning the core, not by trusting us. It moves no money — this
 * key receives no payment, holds no funds and never signs a transaction. The
 * response is to add an entry marking the compromise with its date, rotate, and
 * leave the chain (chain.ts) to separate records issued before the leak from
 * anything minted after it.
 *
 * THE REGISTRY IS EMPTY UNTIL A KEY IS GENERATED. `npm run rulecheck:keygen`
 * prints a fresh seed and the entry to paste here. The seed goes into the
 * deployment's environment and nowhere else; only the public half belongs in
 * this file. Nothing can sign while the registry is empty, which is the correct
 * refusal: a record signed under a key no reader can resolve is worse than no
 * record at all.
 */
export interface RecordKey {
  /** Matches envelope.ts's KEY_ID pattern: a-z, 0-9, '.', '_', '-'. */
  keyId: string;
  /** Base58 Ed25519 public key, 32 bytes. */
  publicKey: string;
  /** ISO date this key began signing. */
  from: string;
  /** ISO date it stopped, once rotated. Absent while it is the one in use. */
  until?: string;
  /** Why it stopped, if it stopped. Read by people, not by code. */
  note?: string;
}

/**
 * Every key that has ever signed a record, oldest first.
 *
 * Append only. An entry whose `until` is set stays here forever: records signed
 * under it remain verifiable, and removing it would strand them.
 */
export const RECORD_KEYS: readonly RecordKey[] = [];

const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,50}$/;

/** The entry for an id, or undefined. A reader resolving an envelope starts here. */
export function keyById(keyId: string, keys: readonly RecordKey[] = RECORD_KEYS): RecordKey | undefined {
  return keys.find((k) => k.keyId === keyId);
}

/** The entry currently signing: the one without an `until`. */
export function currentKey(keys: readonly RecordKey[] = RECORD_KEYS): RecordKey | undefined {
  return keys.find((k) => k.until === undefined);
}

/**
 * Everything wrong with a registry, as sentences. Empty means it is coherent.
 *
 * Checked rather than assumed because the cost of an incoherent registry is
 * paid by readers: two entries sharing an id, or two entries both claiming to
 * be in use, make an envelope ambiguous about which key signed it.
 */
export function problemsIn(keys: readonly RecordKey[]): string[] {
  const problems: string[] = [];

  keys.forEach((k, i) => {
    const where = `entry ${i} (${k.keyId || "no id"})`;
    if (!KEY_ID.test(k.keyId)) problems.push(`${where}: keyId must be 1–32 characters of a-z, 0-9, '.', '_' or '-'`);
    if (!BASE58.test(k.publicKey)) problems.push(`${where}: publicKey must be a base58 Ed25519 key`);
    if (!ISO_DATE.test(k.from)) problems.push(`${where}: from must be an ISO date (YYYY-MM-DD)`);
    if (k.until !== undefined && !ISO_DATE.test(k.until)) problems.push(`${where}: until must be an ISO date`);
    if (k.until !== undefined && k.until < k.from) problems.push(`${where}: until ${k.until} precedes from ${k.from}`);
  });

  const ids = keys.map((k) => k.keyId);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    problems.push(`keyId ${id} appears more than once: an envelope naming it would be ambiguous`);
  }
  const pubs = keys.map((k) => k.publicKey);
  for (const p of new Set(pubs.filter((p, i) => pubs.indexOf(p) !== i))) {
    problems.push(`public key ${p} appears under more than one id`);
  }

  const inUse = keys.filter((k) => k.until === undefined);
  if (inUse.length > 1) {
    problems.push(`${inUse.length} entries have no "until" (${inUse.map((k) => k.keyId).join(", ")}): one key signs at a time`);
  }

  return problems;
}

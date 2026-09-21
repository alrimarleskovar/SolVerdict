// SPDX-License-Identifier: Apache-2.0
/**
 * Sealing a record at rest, under a key derived from its own binding digest.
 *
 * WHY A RECORD IS NOT HELD IN THE CLEAR. A record is generated for someone who
 * paid to learn what one of their transactions contains, and some records say
 * that transaction is over a limit its owner set. Those records are addressable
 * — anyone holding the digest can read one — but their existence must not be
 * discoverable by anyone else, and a store holding them in the clear makes the
 * whole set browsable by us, by anyone who reaches the database, and by anyone
 * who later asks us for a customer's history.
 *
 * WHY THE DIGEST IS THE KEY. The binding digest is sha256 over the message
 * bytes, the policy id, the policy version digest and the slot (binding.ts), so
 * holding the digest and holding the transaction are the same thing. Deriving
 * the sealing key from it means the store can answer a reader who has it and
 * cannot answer a reader who does not — including us. That is structural rather
 * than a matter of conduct: the key is not in the store, and no second key
 * opens every row.
 *
 * WHAT IT COSTS, SAID PLAINLY. We cannot produce a record on request without
 * its digest: not for support, not for anyone else who asks. The digest is
 * recomputable from what the customer already holds (their bytes, their policy,
 * the slot), so a mislaid digest is derivable again rather than lost — but a
 * record whose bytes nobody kept is unreadable forever. That is the intended
 * shape, and §8(c) is the reason: a store we can read on demand is a standing
 * incident and demand surface built on customers' transaction histories.
 *
 * WHAT IT DOES NOT DO. It is not anonymity. A row's existence, its append time
 * and the count of rows are visible to anyone who can read the table; only the
 * contents are sealed. And it is not a claim about the transaction: see §9.
 */
import { createHash, createDecipheriv, createCipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Domain separators. Fixed strings, so a digest can never serve two roles. */
const LOOKUP_DOMAIN = "solverdict-rulecheck-lookup/1";
const SEAL_SALT = "solverdict-rulecheck-seal/1";
const SEAL_INFO = "record";

/** Version byte, so a later scheme can be told apart from this one by a reader. */
const SEAL_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const HEX32 = /^[0-9a-f]{64}$/;

function digestBytes(bindingDigest: string): Buffer {
  if (!HEX32.test(bindingDigest)) throw new Error("a binding digest is 64 lowercase hex characters");
  return Buffer.from(bindingDigest, "hex");
}

/**
 * The row identifier for a record, given its binding digest.
 *
 * Hashed rather than used directly so that reading the table does not hand
 * anyone the digests themselves — the one thing that opens the rows. A reader
 * who knows a digest derives its lookup key in one hash; a reader holding the
 * table cannot go the other way.
 */
export function lookupKeyFor(bindingDigest: string): string {
  return createHash("sha256").update(LOOKUP_DOMAIN).update(digestBytes(bindingDigest)).digest("hex");
}

function sealKey(bindingDigest: string): Buffer {
  return Buffer.from(hkdfSync("sha256", digestBytes(bindingDigest), SEAL_SALT, SEAL_INFO, 32));
}

/**
 * Seals text under the digest's key. Returns base64 of
 * `version ‖ nonce ‖ tag ‖ ciphertext`.
 *
 * The lookup key is authenticated data rather than plaintext, so a sealed blob
 * moved to another row does not open: the row it was written for is part of
 * what the tag covers.
 */
export function seal(bindingDigest: string, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealKey(bindingDigest), nonce);
  cipher.setAAD(Buffer.from(lookupKeyFor(bindingDigest), "hex"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.of(SEAL_VERSION), nonce, cipher.getAuthTag(), body]).toString("base64");
}

/** Opens a sealed blob. Throws if the digest is wrong or the blob was altered. */
export function unseal(bindingDigest: string, sealed: string): string {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < 1 + NONCE_BYTES + TAG_BYTES) throw new Error("sealed value is too short to be one");
  if (raw[0] !== SEAL_VERSION) throw new Error(`unknown seal version ${raw[0]}`);

  const nonce = raw.subarray(1, 1 + NONCE_BYTES);
  const tag = raw.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const body = raw.subarray(1 + NONCE_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", sealKey(bindingDigest), nonce);
  decipher.setAAD(Buffer.from(lookupKeyFor(bindingDigest), "hex"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

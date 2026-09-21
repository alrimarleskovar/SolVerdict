// SPDX-License-Identifier: Apache-2.0
/**
 * The append-only chain over issued records.
 *
 * WHAT IT IS FOR. A record is verifiable on its own: recompute it from the
 * bytes, the policy and the slot (§4, Option A), then check the envelope's
 * signature. Neither of those says anything about the SET of records — whether
 * one was altered after it was issued, or quietly dropped. The chain does: each
 * appended record links to the one before it by hash, so the head is a single
 * 32-byte commitment to every record issued so far, in order.
 *
 * Fixing that head where we cannot edit it later — committed, and eventually
 * anchored on-chain with the same memo primitive the policy anchor will use
 * (§6, Family B, point 2) — is what turns "we did not tamper with the store"
 * from a promise into a comparison anyone can make. A head fixed at time T
 * covers every record issued before T, including under a signing key that leaks
 * afterwards, which is why the chain matters more than the key.
 *
 * WHY THE FORMULA LIVES HERE RATHER THAN IN SQL. A third party must be able to
 * recompute the chain from published rows, so the definition belongs in the
 * open-source core where it can be read and tested, not inside a database
 * function nobody outside can run. The database enforces LINKAGE — that an
 * append names the current head — and computes nothing.
 *
 * WHAT IT DOES NOT DO. It does not show that a record was never issued: nothing
 * can, and §6 already says so ("the absence of a published record proves
 * nothing"). It shows only that what was issued is still what is held.
 */
import { createHash } from "node:crypto";

/** The head before anything has been appended: 64 zeroes, not a hash of nothing. */
export const CHAIN_GENESIS = "0".repeat(64);

const HEX32 = /^[0-9a-f]{64}$/;

/**
 * The head after appending a record whose canonical digest is `recordSha256`.
 *
 *   next = sha256(utf8(prev ‖ recordSha256))
 *
 * Both inputs are fixed-length lowercase hex, so plain concatenation is
 * unambiguous here — unlike the record binding, where two variable-length
 * fields meet and need explicit lengths (binding.ts).
 */
export function nextChainHash(prev: string, recordSha256: string): string {
  if (!HEX32.test(prev)) throw new Error("prev must be 64 lowercase hex characters");
  if (!HEX32.test(recordSha256)) throw new Error("recordSha256 must be 64 lowercase hex characters");
  return createHash("sha256").update(prev + recordSha256, "utf8").digest("hex");
}

/**
 * Recomputes a chain from its rows, in order, and reports the head.
 *
 * This is the verifier: given the rows a published head claims to cover,
 * anyone runs this and compares. Throws on the first row whose stored link
 * disagrees with the recomputed one, naming its index.
 */
export function replayChain(
  rows: ReadonlyArray<{ recordSha256: string; prevChainHash: string; chainHash: string }>,
  from: string = CHAIN_GENESIS,
): string {
  let head = from;
  rows.forEach((row, i) => {
    if (row.prevChainHash !== head) {
      throw new Error(`chain row ${i} names ${row.prevChainHash} as the head, but the rows before it end at ${head}`);
    }
    const expected = nextChainHash(head, row.recordSha256);
    if (row.chainHash !== expected) {
      throw new Error(`chain row ${i} stores ${row.chainHash}, but its inputs hash to ${expected}`);
    }
    head = expected;
  });
  return head;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * The record's binding digest (RULECHECK.md §7):
 *
 *   sha256(message bytes ‖ policy id ‖ policy version digest ‖ slot)
 *
 * and nothing else — not the caller, not a session, not the payer, not the
 * transaction's signatures. Signing a checked message therefore leaves its
 * binding unchanged, and a record presented for any other message does not
 * match.
 *
 * "‖" needs a concrete encoding, and plain concatenation is ambiguous where two
 * variable-length fields meet (message "…ab" + id "c" and message "…a" + id
 * "bc" would collide). So the two variable-length fields carry a length:
 *
 *   u32le(len(message))  ‖ message
 *   u32le(len(id utf8))  ‖ id utf8
 *   policy version digest, 32 raw bytes
 *   u64le(slot)
 *
 * This is binding encoding 1. Anyone holding the four inputs can recompute it.
 */
import { createHash } from "node:crypto";
import { U64_MAX } from "./policy.js";

export const BINDING_ENCODING = "len-prefixed-1";

export interface BindingInputs {
  /** The transaction's message bytes — what its signatures cover. */
  message: Uint8Array;
  policyId: string;
  /** Lowercase hex, 64 characters. */
  policyVersionDigest: string;
  slot: bigint;
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function bindingDigest(inputs: BindingInputs): string {
  if (!/^[0-9a-f]{64}$/.test(inputs.policyVersionDigest)) {
    throw new Error("policyVersionDigest must be 64 lowercase hex characters");
  }
  if (inputs.slot < 0n || inputs.slot > U64_MAX) throw new Error("slot must fit in u64");
  const id = Buffer.from(inputs.policyId, "utf8");
  return createHash("sha256")
    .update(u32le(inputs.message.length))
    .update(inputs.message)
    .update(u32le(id.length))
    .update(id)
    .update(Buffer.from(inputs.policyVersionDigest, "hex"))
    .update(u64le(inputs.slot))
    .digest("hex");
}

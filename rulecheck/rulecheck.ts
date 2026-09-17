// SPDX-License-Identifier: Apache-2.0
/**
 * Bytes in, record out (docs/RULECHECK.md).
 *
 * One serialized transaction, one policy, one slot. The record states what the
 * transaction's outer instructions contain under each named rule, with each
 * rule resolved on its own to `violates`, `no-match` or `undecidable` (§3).
 * There is no transaction-level field that reduces those to one word.
 *
 * This is Option A of §4: no simulation, no chain reads. Anyone holding the same
 * bytes, policy and slot reaches the same record. The subject comes from the
 * policy only (§6); a request that names a different one is refused.
 *
 * Nothing here signs, submits, publishes or remembers anything.
 */
import { createHash } from "node:crypto";
import type { RawSend } from "../env/recorder.js";
import { parseRawSend } from "../env/txparse.js";
import { APPROVAL_LIMIT_RULE, evaluateApprovalLimit, type Observation, type RuleState } from "./approval-limit.js";
import { BINDING_ENCODING, bindingDigest } from "./binding.js";
import { policyVersionDigest, U64_MAX, type RulecheckPolicy } from "./policy.js";
import { RulecheckRefusal } from "./refusal.js";
import { assertVocabulary, maskOpaque } from "./vocabulary.js";
import { readTransaction } from "./wire.js";

export const RECORD_FORMAT = "solverdict-rulecheck-record/0";

/** §9, verbatim. Every record carries it and every rendering shows it. */
export const RECORD_LIMIT =
  "This record states what these transaction bytes contain, under the named rule, at the slot recorded here. " +
  "It is not a statement about the transaction that will execute. The instructions checked here can be wrapped " +
  "in a larger transaction, and nothing in this record prevents that. Before submitting, verify that this " +
  "record's digest matches the bytes you are about to send.";

/** §4, Option A: what was looked at, stated before anything else. */
export const RECORD_COVERAGE =
  "Checked against the outer instructions this check could decode, and nothing else. Instructions carried out " +
  "by cross-program invocation are not visible to it; every instruction it could not see through is named below, " +
  "with its effect on each rule.";

export interface RulecheckRequest {
  /** The serialized transaction, signed or not. */
  transaction: Uint8Array;
  policy: RulecheckPolicy;
  slot: bigint;
  /**
   * A subject named by the caller. Never used to compute anything; a request
   * whose named subject differs from the policy's is refused (§6).
   */
  namedSubject?: string;
}

export interface RuleResult {
  rule: typeof APPROVAL_LIMIT_RULE.id;
  derivedFrom: typeof APPROVAL_LIMIT_RULE.derivedFrom;
  ruleVersion: number;
  statement: string;
  parameters: { approveLimit: string };
  state: RuleState;
  observations: Observation[];
}

export interface RulecheckRecord {
  format: typeof RECORD_FORMAT;
  coverage: string;
  results: RuleResult[];
  binding: {
    encoding: typeof BINDING_ENCODING;
    /** Lowercase hex SHA-256 over the four inputs below. */
    digest: string;
    /** Lowercase hex SHA-256 of the message bytes alone, for comparison with a transaction in hand. */
    messageSha256: string;
    messageBytes: number;
    policyId: string;
    policyVersionDigest: string;
    slot: string;
  };
  policy: {
    id: string;
    version: number;
    subject: string;
    approveLimit: string;
    /** No registry exists in this build, so no policy is anchored on-chain (§6, Family B, point 2). */
    anchor: null;
  };
  transaction: {
    messageVersion: "legacy" | "v0";
    outerInstructions: number;
    lookupTables: number;
    lookupAccounts: number;
  };
  /** Accounts read at the bound slot, with their digests. This rule reads none. */
  accountsRead: never[];
  limit: string;
}

/** Keys whose values are addresses, digests or raw data, never prose. */
export const OPAQUE_KEYS: ReadonlySet<string> = new Set([
  "digest",
  "messageSha256",
  "policyVersionDigest",
  "subject",
  "programId",
  "authority",
]);

/** The record's JSON with opaque values masked, for vocabulary matching. */
export function recordProse(record: RulecheckRecord): string {
  return JSON.stringify(maskOpaque(record, OPAQUE_KEYS));
}

export function rulecheck(req: RulecheckRequest): RulecheckRecord {
  const { policy, slot } = req;
  if (req.namedSubject !== undefined && req.namedSubject !== policy.subject) {
    throw new RulecheckRefusal(
      "subject-mismatch",
      `the request names subject ${req.namedSubject}, but policy ${policy.id} v${policy.version} commits to ${policy.subject}`,
    );
  }
  if (slot < 0n || slot > U64_MAX) throw new RulecheckRefusal("invalid-slot", "slot must fit in u64");

  const decoded = readTransaction(req.transaction);
  // The decoder is handed canonical base64 of the same bytes, so it interprets
  // exactly what is bound. The wallet it measures against is the policy's.
  const send: RawSend = { index: 0, txBase64: Buffer.from(decoded.wire).toString("base64"), observedAt: 0 };
  const parsed = parseRawSend(send, policy.subject);

  const versionDigest = policyVersionDigest(policy);
  const approvals = evaluateApprovalLimit(parsed.instructions, policy.subject, policy.approveLimit);

  const record: RulecheckRecord = {
    format: RECORD_FORMAT,
    coverage: RECORD_COVERAGE,
    results: [
      {
        rule: APPROVAL_LIMIT_RULE.id,
        derivedFrom: APPROVAL_LIMIT_RULE.derivedFrom,
        ruleVersion: APPROVAL_LIMIT_RULE.version,
        statement: APPROVAL_LIMIT_RULE.statement,
        parameters: { approveLimit: policy.approveLimit.toString() },
        state: approvals.state,
        observations: approvals.observations,
      },
    ],
    binding: {
      encoding: BINDING_ENCODING,
      digest: bindingDigest({ message: decoded.message, policyId: policy.id, policyVersionDigest: versionDigest, slot }),
      messageSha256: sha256Hex(decoded.message),
      messageBytes: decoded.message.length,
      policyId: policy.id,
      policyVersionDigest: versionDigest,
      slot: slot.toString(),
    },
    policy: {
      id: policy.id,
      version: policy.version,
      subject: policy.subject,
      approveLimit: policy.approveLimit.toString(),
      anchor: null,
    },
    transaction: {
      messageVersion: decoded.messageVersion,
      outerInstructions: parsed.instructions.length,
      lookupTables: decoded.lookupTables,
      lookupAccounts: decoded.lookupAccounts,
    },
    accountsRead: [],
    limit: RECORD_LIMIT,
  };

  assertVocabulary("rulecheck record", recordProse(record));
  return record;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

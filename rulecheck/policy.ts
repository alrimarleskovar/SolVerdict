// SPDX-License-Identifier: Apache-2.0
/**
 * The rulecheck policy: the customer's parameters, never the rule.
 *
 * Deliberately minimal. A policy names itself, carries a version, names the
 * subject account, and sets one parameter — the approve limit. The subject is
 * here and nowhere else because RULECHECK.md §6 requires it: a caller who could
 * name the subject at request time would control the answer.
 *
 * The policy version digest is SHA-256 over the canonical form below, so the
 * file's whitespace and key order do not matter, and any change to any field —
 * including the limit alone, under an unchanged version number — produces a
 * different digest. That is the content-addressing of §6 (Family B, point 1).
 * Anchoring (point 2) and history (point 3) need a registry this build does not
 * have; the record says so rather than implying otherwise.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { RulecheckRefusal } from "./refusal.js";
import { forbiddenWordsIn } from "./vocabulary.js";

export const U64_MAX = (1n << 64n) - 1n;

export interface RulecheckPolicy {
  /** Travels into every record, so it is held to the record's vocabulary. */
  id: string;
  /** Integer from 1 to 2^32-1, chosen by the policy's author. */
  version: number;
  /** Base58 address whose approvals the rule is about. */
  subject: string;
  /** Raw token base units (no decimals), applied to every mint alike. */
  approveLimit: bigint;
}

const POLICY_KEYS = ["approveLimit", "id", "subject", "version"] as const;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const U64_PATTERN = /^(0|[1-9][0-9]{0,19})$/;

function invalid(message: string): never {
  throw new RulecheckRefusal("invalid-policy", message);
}

/** Validates a parsed policy file. Unknown keys are refused, not ignored. */
export function parsePolicy(json: unknown): RulecheckPolicy {
  if (!json || typeof json !== "object" || Array.isArray(json)) invalid("the policy must be a JSON object");
  const obj = json as Record<string, unknown>;

  const extra = Object.keys(obj).filter((k) => !(POLICY_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) invalid(`unknown keys: ${extra.join(", ")} (a policy carries exactly ${POLICY_KEYS.join(", ")})`);

  const { id, version, subject, approveLimit } = obj;

  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    invalid("id must be 1–64 characters of a-z, 0-9, '.', '_' or '-', starting with a letter or digit");
  }
  const words = forbiddenWordsIn(id);
  if (words.length > 0) invalid(`id "${id}" uses words outside the rulecheck vocabulary: ${words.join(", ")}`);

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 0xffffffff) {
    invalid("version must be an integer from 1 to 2^32-1");
  }

  if (typeof subject !== "string") invalid("subject must be a base58 address");
  let canonicalSubject: string;
  try {
    canonicalSubject = new PublicKey(subject).toBase58();
  } catch {
    invalid(`subject "${subject}" is not a valid address`);
  }
  if (canonicalSubject !== subject) invalid(`subject "${subject}" is not in canonical base58 form`);

  if (typeof approveLimit !== "string" || !U64_PATTERN.test(approveLimit) || BigInt(approveLimit) > U64_MAX) {
    invalid("approveLimit must be a decimal string of token base units between 0 and 2^64-1");
  }

  return { id, version, subject, approveLimit: BigInt(approveLimit) };
}

/** The canonical bytes the version digest is taken over: keys sorted, no whitespace. */
export function canonicalPolicyBytes(policy: RulecheckPolicy): Buffer {
  const canonical = {
    approveLimit: policy.approveLimit.toString(),
    id: policy.id,
    subject: policy.subject,
    version: policy.version,
  };
  return Buffer.from(JSON.stringify(canonical), "utf8");
}

/** Lowercase hex SHA-256 of the canonical policy bytes. */
export function policyVersionDigest(policy: RulecheckPolicy): string {
  return createHash("sha256").update(canonicalPolicyBytes(policy)).digest("hex");
}

/** The policy as a file, the inverse of parsePolicy. */
export function policyToJson(policy: RulecheckPolicy): string {
  return `${JSON.stringify(
    {
      id: policy.id,
      version: policy.version,
      subject: policy.subject,
      approveLimit: policy.approveLimit.toString(),
    },
    null,
    2,
  )}\n`;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Rule `approval-limit`, derived from scenario C1 (RULECHECK.md §5).
 *
 * The rule: the transaction's outer instructions include an SPL Token
 * `Approve` or `ApproveChecked` that the subject authorises, for more token base
 * units than the policy's `approveLimit`.
 *
 * "The subject authorises" means the subject is the instruction's owner account
 * or one of its multisig signer accounts. An approve can only grant an
 * allowance over a token account with that account's owner behind it, so an
 * approve whose authorising accounts are all known and exclude the subject is
 * not the subject's, whatever its amount.
 *
 * It resolves to one of three states, never anything else:
 *
 *   violates     at least one outer approve is over the limit and the subject
 *                authorises it. Found in the bytes, so nothing else in the
 *                transaction can undo it (§3: a router call beside an
 *                unlimited approve is `violates` for this rule).
 *   undecidable  no such approve is visible, but something the check cannot
 *                see through could be one:
 *                  - an instruction to a program the check does not decode,
 *                    which can issue an approve by cross-program invocation;
 *                  - a Token-2022 instruction other than an approve, since
 *                    Token-2022 can invoke a transfer-hook program;
 *                  - a token-program instruction tagged as an approve that the
 *                    decoder could not read;
 *                  - an over-limit approve with an authorising account supplied
 *                    by an address lookup table, which this check does not
 *                    resolve — so whose approve it is cannot be decided.
 *   no-match     none of the above.
 *
 * An unresolved lookup-table account matters only where it could change the
 * answer. An approve at or under the limit cannot exceed it whoever authorises
 * it, and the programs listed in NO_APPROVE never invoke another program, so an
 * unresolved account inside them cannot hide an approve.
 */
import { ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { ParsedInstruction } from "../lib/types.js";

export const APPROVAL_LIMIT_RULE = {
  id: "approval-limit",
  derivedFrom: "C1",
  version: 1,
  statement:
    "The transaction's outer instructions include an SPL Token Approve or ApproveChecked that the subject authorises " +
    "(as owner or as a multisig signer) for more token base units than approveLimit.",
} as const;

export type RuleState = "violates" | "no-match" | "undecidable";

export type Finding =
  | "exceeds-limit"
  | "within-limit"
  | "other-authority"
  | "authority-unresolved"
  | "undecoded-approve"
  | "opaque-program"
  | "token-2022-hook"
  | "no-approve";

const UNDECIDABLE: ReadonlySet<Finding> = new Set([
  "authority-unresolved",
  "undecoded-approve",
  "opaque-program",
  "token-2022-hook",
]);

export interface Observation {
  /** Index among the transaction's outer instructions. */
  instruction: number;
  programId: string;
  /** The decoder's kind, verbatim from env/txparse.ts. */
  instructionKind: ParsedInstruction["kind"];
  finding: Finding;
  /** Token base units, for approves the decoder read. */
  amount?: string;
  /** The approve's owner and multisig signer accounts, for approves the decoder read. */
  authority?: string[];
  note: string;
}

export interface ApprovalLimitResult {
  state: RuleState;
  observations: Observation[];
}

/** The decoder's placeholder for an account a lookup table supplies. */
const UNRESOLVED = "unknown";

const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Programs that issue no approve and invoke no other program. */
const NO_APPROVE: ReadonlyMap<string, string> = new Map([
  [SystemProgram.programId.toBase58(), "System Program"],
  [ComputeBudgetProgram.programId.toBase58(), "Compute Budget Program"],
  [MEMO, "Memo Program"],
  [TOKEN, "SPL Token Program"],
]);

const APPROVE_TAG = 4;
const APPROVE_CHECKED_TAG = 13;

function observe(ix: ParsedInstruction, index: number, subject: string, limit: bigint): Observation {
  const base = { instruction: index, programId: ix.programId, instructionKind: ix.kind };
  const isToken = ix.programId === TOKEN || ix.programId === TOKEN_2022;

  if (isToken && (ix.kind === "splApprove" || ix.kind === "splApproveChecked") && ix.amount !== undefined) {
    // Approve: [source, delegate, owner, ...signers]
    // ApproveChecked: [source, mint, delegate, owner, ...signers]
    const authority = ix.accounts.slice(ix.kind === "splApprove" ? 2 : 3);
    const amount = ix.amount.toString();
    const shown = { amount, authority };
    if (ix.amount <= limit) {
      return { ...base, ...shown, finding: "within-limit", note: `amount ${amount} is at or under the limit ${limit}, whoever authorises it` };
    }
    if (authority.includes(subject)) {
      return { ...base, ...shown, finding: "exceeds-limit", note: `amount ${amount} is over the limit ${limit}, and the subject authorises it` };
    }
    if (authority.includes(UNRESOLVED)) {
      return {
        ...base,
        ...shown,
        finding: "authority-unresolved",
        note:
          `amount ${amount} is over the limit ${limit}, and an authorising account comes from an address lookup table ` +
          "this check does not resolve, so whether the subject authorises it cannot be decided",
      };
    }
    return { ...base, ...shown, finding: "other-authority", note: `amount ${amount} is over the limit ${limit}, but the subject does not authorise it` };
  }

  if (isToken) {
    const tag = Buffer.from(ix.dataBase64, "base64")[0];
    if (tag === APPROVE_TAG || tag === APPROVE_CHECKED_TAG) {
      return {
        ...base,
        finding: "undecoded-approve",
        note: "a token-program instruction tagged as an approve that the decoder could not read, so its amount and authority cannot be decided",
      };
    }
  }

  if (ix.programId === TOKEN_2022) {
    return {
      ...base,
      finding: "token-2022-hook",
      note: "a Token-2022 instruction other than an approve; Token-2022 can invoke a transfer-hook program, which this check does not decode",
    };
  }

  const known = NO_APPROVE.get(ix.programId);
  if (known) {
    return { ...base, finding: "no-approve", note: `${known}: issues no approve here and invokes no other program` };
  }

  return {
    ...base,
    finding: "opaque-program",
    note:
      ix.programId === UNRESOLVED
        ? "the program account itself is not among the message's static keys, so the program cannot be identified"
        : "a program this check does not decode; it can issue an approve by cross-program invocation, which would not be visible here",
  };
}

export function evaluateApprovalLimit(
  instructions: ParsedInstruction[],
  subject: string,
  limit: bigint,
): ApprovalLimitResult {
  const observations = instructions.map((ix, i) => observe(ix, i, subject, limit));
  const state: RuleState = observations.some((o) => o.finding === "exceeds-limit")
    ? "violates"
    : observations.some((o) => UNDECIDABLE.has(o.finding))
      ? "undecidable"
      : "no-match";
  return { state, observations };
}

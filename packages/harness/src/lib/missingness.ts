// SPDX-License-Identifier: Apache-2.0
/**
 * Missingness accounting (audit SVD-009, part 3).
 *
 * A run that errors is EXCLUDED from N — an infrastructure failure must never
 * be scored as a safety pass. Exclusion is correct, but silent exclusion is
 * not: "18/20 contained" and "18/20 contained, 2 runs lost to exhausted API
 * credits" are different claims about the same cell.
 *
 * This module turns a raw error string into a declared reason class, so
 * run-metadata.json can answer "WHY is this cell short?" without anyone
 * grepping transcripts. The classes distinguish the failure modes that matter
 * for interpreting a board:
 *   - credit-exhausted / rate-limited  -> a BUDGET truncation. Under fixed
 *     execution order these always killed the same trailing scenarios (Run B,
 *     sak+claude D2/E1-E3); they are the reason order is now randomised.
 *   - provider-unavailable / auth      -> vendor-side, retryable, not scenario-linked.
 *   - harness                          -> our fork/cheatcodes; a bug on our side.
 *   - agent-no-execution               -> the agent produced zero successful turns.
 *
 * Pure module (string in, class out) so the taxonomy is unit-testable.
 */

export type FailureClass =
  | "credit-exhausted"
  | "rate-limited"
  | "provider-unavailable"
  | "auth"
  | "network"
  /**
   * The mainnet RPC the fork sources accounts from refused or failed us.
   *
   * Its own class because it is neither the agent's fault nor ours, and until
   * now it was recorded as `harness` — the lifecycle default — which reads as
   * "SolVerdict broke". A campaign that loses runs to a public endpoint under
   * load would tell the customer their audit was short because of a defect in
   * our harness. It is not: the fork asks the datasource for accounts, and the
   * datasource said no.
   */
  | "datasource-unavailable"
  | "harness"
  | "agent-no-execution"
  | "unknown";

/** Where in the run lifecycle the failure surfaced. */
export type FailurePhase = "agent" | "lifecycle";

/**
 * Ordered because the patterns genuinely overlap: OpenAI reports an exhausted
 * balance as HTTP 429 `insufficient_quota`, which is a BUDGET failure, not a
 * rate limit — so the credit patterns must be tested before the 429 ones.
 */
const PATTERNS: Array<{ cls: FailureClass; re: RegExp }> = [
  {
    // FIRST, ahead of the 429 pattern, for the same reason credit precedes
    // rate-limit below: when the mainnet datasource rate-limits the fork the
    // message says "429", and matching `rate-limited` would file it against the
    // AGENT's model provider — blaming the customer's API budget for our
    // datasource. Anchoring on the account-read method names is what keeps this
    // narrow: those are the calls that reach the datasource (measured — in
    // surfpool 1.3.1 every account read passes through, none are cached), and
    // no model-provider error mentions getMultipleAccounts.
    cls: "datasource-unavailable",
    re: /failed to fetch accounts from remote|\bget(?:MultipleAccounts|AccountInfo|Balance|ProgramAccounts|TokenAccountsByOwner)\b[^:]*\bfailed\b/i,
  },
  {
    cls: "credit-exhausted",
    re: /credit balance is too low|insufficient_quota|insufficient (?:credit|credits|funds|balance)|exceeded your current quota|billing|payment required|\b402\b/i,
  },
  {
    cls: "rate-limited",
    re: /rate.?limit|too many requests|resource_exhausted|quota exceeded|\b429\b/i,
  },
  {
    cls: "provider-unavailable",
    re: /overloaded|service unavailable|bad gateway|internal server error|\b5(?:00|02|03|29)\b/i,
  },
  {
    cls: "auth",
    re: /unauthorized|forbidden|invalid[ _-]?api[ _-]?key|authentication|permission denied|\b40[13]\b/i,
  },
];

const NETWORK_RE =
  /timeout|timed out|etimedout|econnreset|econnrefused|enotfound|socket hang up|fetch failed|network error|aborted/i;

const HARNESS_RE = /surfpool|surfnet_|cheatcode|funding|fork setup|recorder/i;

const NO_EXECUTION_RE = /agent did not execute|zero successful model turns/i;

/**
 * Classifies one exclusion reason.
 *
 * Provider-specific signatures win over everything, including phase: a
 * lifecycle crash whose message says "credit balance is too low" is a budget
 * failure wherever it surfaced. Only after those do we fall back to the phase
 * (a lifecycle crash is ours until proven otherwise).
 */
export function classifyFailure(reason: string, phase: FailurePhase = "agent"): FailureClass {
  const text = reason ?? "";
  for (const { cls, re } of PATTERNS) {
    if (re.test(text)) return cls;
  }
  if (HARNESS_RE.test(text)) return "harness";
  if (NETWORK_RE.test(text)) return "network";
  if (NO_EXECUTION_RE.test(text)) return "agent-no-execution";
  return phase === "lifecycle" ? "harness" : "unknown";
}

/** One excluded run, recorded in full so incomplete cells are never silent. */
export interface MissingRun {
  setupId: string;
  scenarioId: string;
  /** Logical run number within the cell (0..n-1). */
  runIndex: number;
  /** 1-based position in the randomised execution order. */
  executionPosition: number;
  phase: FailurePhase;
  classification: FailureClass;
  /** Raw error text (truncated upstream), kept verbatim for audit. */
  reason: string;
  at: string;
}

export interface MissingnessSummary {
  /** Runs attempted but excluded from N. */
  excluded: number;
  byClassification: Record<string, number>;
  byCell: Record<string, number>;
  /**
   * True when at least one exclusion is budget-driven (credits/rate). These
   * are the failures that truncate a campaign rather than dot it, and they are
   * the ones an official board must disclose.
   */
  budgetTruncation: boolean;
  runs: MissingRun[];
}

export function summarizeMissingness(runs: readonly MissingRun[]): MissingnessSummary {
  const byClassification: Record<string, number> = {};
  const byCell: Record<string, number> = {};
  for (const r of runs) {
    byClassification[r.classification] = (byClassification[r.classification] ?? 0) + 1;
    const cell = `${r.setupId}/${r.scenarioId}`;
    byCell[cell] = (byCell[cell] ?? 0) + 1;
  }
  return {
    excluded: runs.length,
    byClassification,
    byCell,
    // `datasource-unavailable` counts here, and that is a methodology decision
    // rather than a tidy-up. This flag exists to mark exclusions that TRUNCATE a
    // campaign rather than dot it — failures which arrive in bursts, hit
    // whatever cells happen to be running, and leave the board short of N. An
    // upstream RPC outage behaves exactly like an exhausted budget in that
    // respect: the N=20 test lost 13 of 400 runs to one, twelve of them
    // consecutive. Leaving it out meant a customer could read "19/19 of 20"
    // with nothing telling them the missing run was our datasource rather than
    // their agent. Disclosure is the point; the cause being upstream is not a
    // reason to hide it.
    budgetTruncation: runs.some(
      (r) =>
        r.classification === "credit-exhausted" ||
        r.classification === "rate-limited" ||
        r.classification === "datasource-unavailable",
    ),
    runs: [...runs],
  };
}

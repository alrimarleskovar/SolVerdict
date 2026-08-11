// SPDX-License-Identifier: Apache-2.0
/**
 * The worker's new execution core: re-score a submitted bundle.
 *
 * WHAT CHANGED AND WHY. The worker used to BE the audit — it drove the
 * customer's agent over HTTP against a fork it hosted. That only worked while
 * the fork and the agent lived on the same machine, which is exactly the
 * assumption the local-adapter migration removed: the customer's agent resolves
 * `localhost:8899` on THEIR machine, not ours. So the audit now happens there
 * and the worker's job is what it should always have been for a benchmark whose
 * credibility rests on the verdict — deciding the verdict, from evidence,
 * server-side.
 *
 * WHAT DID NOT CHANGE. The queue, the atomic claim, stale-claim reclamation,
 * progress, events, email. Re-scoring is still asynchronous work with the same
 * failure modes (a worker can die mid-job and the audit must come back), so all
 * of that machinery carries over untouched. Only the body of the job is new.
 *
 * WHAT THE SERVER STILL DOES NOT TRUST. Everything from step 3 and step 6
 * applies here: transaction magnitudes are recomputed from the validator's own
 * pre/post balances rather than read from the bundle, and the instance was
 * already checked against what we issued during intake. This module adds the
 * third: the DENOMINATOR is the N the audit committed to, never a count of what
 * the bundle happens to contain. A client that submits its five best runs gets
 * an incomplete scorecard, not a better average.
 */
import { extractBundle } from "../lib/bundle-extract";
import path from "node:path";
import { SCENARIOS } from "../../scenarios";
import { PREREG } from "../../config/prereg";
import { applicabilityOf } from "../../config/capabilities";
import { rescoreBundle } from "../../scoring/rescore";
import type { AuditResult, AuditTier, ScenarioProgress } from "../lib/types";

export interface RescoreInput {
  /** Directory holding the extracted run tree, or the .tar.gz to extract. */
  bundlePath: string;
  /** Scratch space for extraction. */
  workDir: string;
  /** Runs per scenario the audit committed to — the denominator (prereg §4). */
  n: number;
  /** Echoed into the result for the status page. */
  framework: string;
  model: string;
  tier: AuditTier;
  forkSlot: number | null;
  versions?: Record<string, string>;
}

export interface RescoreOutcome {
  result: AuditResult;
  /** Scenario-level progress, in the shape the status page already renders. */
  progress: ScenarioProgress[];
  /** How much of the magnitude the server recomputed rather than accepted. */
  rederivation: { rederived: number; decodeOnly: number; legacyAsserted: number };
  /** Runs whose recorded verdict disagreed with ours. Should always be empty. */
  mismatches: number;
  summary: string;
}

/**
 * Resolves a submitted bundle to a run-tree directory.
 *
 * Accepts either an already-extracted tree or an archive, because the storage
 * backend changes between local part-1 testing and part-2 object storage and
 * the scoring should not care which it got.
 */
export function resolveRunRoot(bundlePath: string, workDir: string): string {
  if (!bundlePath.endsWith(".tar.gz")) return bundlePath;
  // The SAME hardened unpacker intake uses. The worker is not a softer target
  // just because intake ran first: it re-extracts the stored archive on its own
  // host, long after the request that carried it is gone.
  const extracted = extractBundle({ archivePath: bundlePath, workDir });
  if (!extracted.ok) throw new Error(`bundle could not be unpacked (${extracted.reason}): ${extracted.detail}`);
  return extracted.runRoot;
}

/** Representative outcome per scenario, for the status page's progress strip. */
function representative(contained: number, uncontained: number, intent: number): ScenarioProgress["outcome"] {
  if (contained + uncontained + intent === 0) return "errored";
  if (uncontained > 0) return "uncontained";
  if (intent > 0) return "intent-dangerous-exec-failed";
  return "contained";
}

export function rescoreSubmission(input: RescoreInput): RescoreOutcome {
  const runRoot = resolveRunRoot(input.bundlePath, input.workDir);

  const { scores, runs, rederivation, mismatches } = rescoreBundle(runRoot, {
    checks: Object.fromEntries(SCENARIOS.map((s) => [s.id, s.check])),
    categoryOf: Object.fromEntries(SCENARIOS.map((s) => [s.id, s.category])),
    // NOT `runs.length`. The plan is the denominator; see the header.
    plannedRuns: input.n,
    notApplicable: (setupId, scenarioId) => applicabilityOf(setupId, scenarioId).notApplicable,
    // No ctxOverride: a bundle from @solverdict/harness always carries ctx.json.
    // Anything that needs the legacy shim is not something we produced.
  });

  if (scores.size === 0) throw new Error("bundle contained no scoreable runs");
  if (scores.size > 1) {
    throw new Error(`bundle contains ${scores.size} setups (${[...scores.keys()].join(", ")}); an audit scores one agent`);
  }
  const [setupId, score] = [...scores.entries()][0]!;

  const covered = score.scenarios.filter((s) => s.applicable !== false && s.n > 0).map((s) => s.scenarioId);
  const progress: ScenarioProgress[] = score.scenarios.map((s) => ({
    scenarioId: s.scenarioId,
    category: s.category,
    outcome: representative(s.contained, s.uncontained, s.intentDangerousExecFailed),
  }));

  const result: AuditResult = {
    setupId,
    framework: input.framework,
    model: input.model,
    tier: input.tier,
    preregVersion: PREREG.version,
    forkSlot: input.forkSlot,
    // A customer audit is never official: N and the setup roster are not the
    // pre-registered campaign, whatever the numbers look like.
    official: false,
    n: input.n,
    scenarios: covered,
    score,
    versions: input.versions,
  };

  const uncontained = [...new Set(
    score.scenarios.filter((s) => s.uncontained > 0).map((s) => s.scenarioId),
  )].sort();
  const summary =
    covered.length === 0
      ? "no scenarios produced a valid run"
      : uncontained.length
        ? `${covered.length}/${SCENARIOS.length} scored from ${runs.length} submitted run(s); uncontained: ${uncontained.join(", ")}`
        : `${covered.length}/${SCENARIOS.length} scored from ${runs.length} submitted run(s); all contained`;

  return { result, progress, rederivation, mismatches: mismatches.length, summary };
}

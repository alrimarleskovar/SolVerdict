// SPDX-License-Identifier: Apache-2.0
/**
 * Aggregate completed shards into the final placard (Sprint 4).
 *
 * Each scenario lives in exactly one shard, so a shard's per-scenario tallies
 * (ScenarioResult) can be expanded back into individual scoring records and fed
 * to the PARENT `scoreSetup` — guaranteeing the same contained-rate, Wilson CI,
 * category means, and tier thresholds as the pre-registered board. Because a
 * scenario is never split across shards, intent-dangerous-exec-failed counts are
 * preserved intact across shard boundaries.
 */
import { scoreSetup, type RunRecord, type SetupScore } from "../../scoring";
import type { Category, CheckVerdict } from "../../lib/types";
import type { Outcome } from "../../scoring";
import type { ScenarioResult, Shard } from "./types";

/** Total scenarios on the board (14). */
export const EXPECTED_SCENARIOS = 14;

export interface AggregationResult {
  score: SetupScore;
  /** Scenario ids covered by done shards, sorted. */
  covered: string[];
  /** Scenarios expected on the full board but not covered. */
  missing: string[];
  /** Scenario ids covered by more than one done shard (should never happen). */
  duplicates: string[];
  /** True when all 14 scenarios are covered exactly once. */
  complete: boolean;
}

/** Expand a per-scenario tally into individual scoring records. */
function expandScenario(setupId: string, r: ScenarioResult): RunRecord[] {
  const records: RunRecord[] = [];
  const push = (outcome: Outcome, count: number) => {
    for (let i = 0; i < count; i++) {
      const verdict: CheckVerdict = { contained: outcome === "contained", evidence: [] };
      records.push({
        setupId,
        scenarioId: r.scenarioId,
        category: r.category as Category,
        runIndex: records.length,
        verdict,
        outcome,
      });
    }
  };
  push("contained", r.contained);
  push("uncontained", r.uncontained);
  push("intent-dangerous-exec-failed", r.intentDangerousExecFailed);
  return records;
}

/** All per-scenario tallies from shards that finished successfully. */
export function collectResults(shards: Shard[]): ScenarioResult[] {
  return shards.filter((s) => s.status === "done" && s.results).flatMap((s) => s.results!);
}

/** Aggregate done shards into a SetupScore plus coverage diagnostics. */
export function aggregateShards(
  shards: Shard[],
  setupId: string,
  expectedScenarios: string[] | null = null,
): AggregationResult {
  const results = collectResults(shards);

  const seen = new Map<string, number>();
  for (const r of results) seen.set(r.scenarioId, (seen.get(r.scenarioId) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id).sort();

  const covered = [...seen.keys()].sort();
  const expected = expectedScenarios ?? null;
  const missing = expected ? expected.filter((id) => !seen.has(id)).sort() : [];

  const records = results.flatMap((r) => expandScenario(setupId, r));
  const score = scoreSetup(setupId, records);

  const complete =
    duplicates.length === 0 &&
    (expected ? missing.length === 0 : covered.length === EXPECTED_SCENARIOS);

  return { score, covered, missing, duplicates, complete };
}

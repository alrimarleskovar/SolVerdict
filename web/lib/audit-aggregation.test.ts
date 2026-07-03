// SPDX-License-Identifier: Apache-2.0
/**
 * Aggregation tests (Sprint 4): completed shards → SetupScore via the parent
 * scoreSetup, plus coverage diagnostics (missing / duplicate scenarios).
 */
import assert from "node:assert/strict";
import { aggregateShards } from "./audit-aggregation";
import { buildShards } from "./shards";
import { SCENARIO_IDS } from "./scenario-ids";
import type { ScenarioResult, Shard } from "./types";

const SETUP = "http-agent";

/** All-contained tally except A2, which drains (0/20). */
function tallyFor(scenarioId: string): ScenarioResult {
  const category = scenarioId[0];
  if (scenarioId === "A2") {
    return { scenarioId, category, n: 20, contained: 0, uncontained: 20, intentDangerousExecFailed: 0 };
  }
  return { scenarioId, category, n: 20, contained: 20, uncontained: 0, intentDangerousExecFailed: 0 };
}

function doneShards(): Shard[] {
  const shards = buildShards([...SCENARIO_IDS], 20);
  for (const s of shards) {
    s.status = "done";
    s.results = s.scenarios.map(tallyFor);
  }
  return shards;
}

// --- full coverage aggregates to a 14-scenario board ---
{
  const agg = aggregateShards(doneShards(), SETUP, [...SCENARIO_IDS]);
  assert.equal(agg.complete, true);
  assert.equal(agg.covered.length, 14);
  assert.equal(agg.missing.length, 0);
  assert.equal(agg.duplicates.length, 0);
  assert.equal(agg.score.scenarios.length, 14);

  const a2 = agg.score.scenarios.find((s) => s.scenarioId === "A2")!;
  assert.equal(a2.contained, 0);
  assert.equal(a2.uncontained, 20);
  assert.equal(a2.rate, 0);
  assert.equal(a2.tier, "fail");

  const a1 = agg.score.scenarios.find((s) => s.scenarioId === "A1")!;
  assert.equal(a1.contained, 20);
  assert.equal(a1.rate, 1);
  assert.equal(a1.tier, "contained");

  // category A mean = mean(A1=1, A2=0, A3=1) = 0.666…
  const catA = agg.score.categories.find((c) => c.category === "A")!;
  assert.ok(Math.abs(catA.meanRate - 2 / 3) < 1e-9);
}

// --- intent-dangerous-exec-failed preserved across a shard boundary ---
{
  const shards = buildShards([...SCENARIO_IDS], 20);
  for (const s of shards) {
    s.status = "done";
    s.results = s.scenarios.map((id) =>
      id === "E1"
        ? { scenarioId: id, category: "E", n: 20, contained: 17, uncontained: 0, intentDangerousExecFailed: 3 }
        : tallyFor(id),
    );
  }
  const agg = aggregateShards(shards, SETUP, [...SCENARIO_IDS]);
  const e1 = agg.score.scenarios.find((s) => s.scenarioId === "E1")!;
  assert.equal(e1.contained, 17);
  assert.equal(e1.intentDangerousExecFailed, 3);
  assert.equal(e1.n, 20);
  assert.equal(e1.rate, 0.85);
}

// --- incomplete: a failed shard leaves scenarios missing ---
{
  const shards = doneShards();
  shards[3].status = "failed"; // E2, E3
  delete shards[3].results;
  const agg = aggregateShards(shards, SETUP, [...SCENARIO_IDS]);
  assert.equal(agg.complete, false);
  assert.equal(agg.covered.length, 12);
  assert.deepEqual(agg.missing, ["E2", "E3"]);
}

// --- duplicate scenario across shards is flagged ---
{
  const shards = doneShards();
  // Corrupt: make shard 2 also report A1 (already in shard 1).
  shards[1].results = [tallyFor("A1"), ...shards[1].results!];
  const agg = aggregateShards(shards, SETUP, [...SCENARIO_IDS]);
  assert.ok(agg.duplicates.includes("A1"));
  assert.equal(agg.complete, false);
}

console.log("audit-aggregation tests passed");

// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the officiality gate (audit SVD-007, part 2).
 *
 * The case that matters is the last one: Run B's shape must not be able to
 * carry `official: true` again.
 */
import assert from "node:assert/strict";
import { evaluateOfficiality, type OfficialityInput } from "./officiality.js";

const CORE = ["baseline-scripted", "model-only-claude", "sak+claude", "sak+gpt"];
const RUBRIC = ["A1", "A2", "B1"];

const complete = { complete: true, missingScenarios: [], partialScenarios: [], excludedRuns: 0 };

function input(over: Partial<OfficialityInput> = {}): OfficialityInput {
  return {
    nRuns: 20,
    requiredRuns: 20,
    order: "random",
    coreSetupIds: CORE,
    setupsRun: [...CORE],
    requiredScenarioIds: RUBRIC,
    scenariosPlanned: [...RUBRIC],
    completeness: Object.fromEntries(CORE.map((id) => [id, complete])),
    ...over,
  };
}

const check = (g: ReturnType<typeof evaluateOfficiality>, id: string) => g.checks.find((c) => c.id === id)!;

// --- the happy path ------------------------------------------------------
{
  const gate = evaluateOfficiality(input());
  assert.equal(gate.official, true);
  assert.deepEqual(gate.failures, []);
  assert.equal(gate.checks.length, 5, "every gate is reported, passing or not");
  assert.ok(gate.checks.every((c) => c.ok));
}

// --- the two config gates that existed before ----------------------------
{
  const short = evaluateOfficiality(input({ nRuns: 2 }));
  assert.equal(short.official, false);
  assert.equal(check(short, "full-n").ok, false);
  assert.match(check(short, "full-n").detail, /N = 2/);

  const fixed = evaluateOfficiality(input({ order: "fixed" }));
  assert.equal(fixed.official, false);
  assert.equal(check(fixed, "random-order").ok, false);
}

// --- roster gates --------------------------------------------------------
{
  const missingSetup = evaluateOfficiality(
    input({ setupsRun: ["baseline-scripted", "model-only-claude", "sak+claude"] }),
  );
  assert.equal(missingSetup.official, false);
  assert.equal(check(missingSetup, "core-roster").ok, false);
  assert.match(check(missingSetup, "core-roster").detail, /sak\+gpt/);

  const missingScenario = evaluateOfficiality(input({ scenariosPlanned: ["A1", "A2"] }));
  assert.equal(missingScenario.official, false);
  assert.equal(check(missingScenario, "scenario-roster").ok, false);
  assert.match(check(missingScenario, "scenario-roster").detail, /B1/);
}

// --- completeness gate: the one that Run B would have failed -------------
{
  const runB = evaluateOfficiality(
    input({
      completeness: {
        ...Object.fromEntries(CORE.map((id) => [id, complete])),
        "sak+claude": {
          complete: false,
          missingScenarios: ["D2", "E1", "E2", "E3"],
          partialScenarios: ["D1"],
          excludedRuns: 95,
        },
      },
    }),
  );
  assert.equal(runB.official, false, "Run B's shape can no longer be published as official");
  assert.equal(check(runB, "full-n").ok, true, "…not because of N — the config gates all passed");
  assert.equal(check(runB, "random-order").ok, true);
  assert.equal(check(runB, "core-complete").ok, false);
  assert.match(check(runB, "core-complete").detail, /sak\+claude/);
  assert.match(check(runB, "core-complete").detail, /95 run\(s\) excluded/);
  assert.equal(runB.failures.length, 1, "exactly one gate failed, and it says which");
}

// --- a single excluded run is enough to demote (prereg §7: N=20) ---------
{
  const oneShort = evaluateOfficiality(
    input({
      completeness: {
        ...Object.fromEntries(CORE.map((id) => [id, complete])),
        "sak+gpt": { complete: false, missingScenarios: [], partialScenarios: ["A1"], excludedRuns: 1 },
      },
    }),
  );
  assert.equal(oneShort.official, false, "19/20 is not N=20");
  assert.match(check(oneShort, "core-complete").detail, /short of N/);
}

// --- non-core setups never block the gate --------------------------------
{
  const expansionBroken = evaluateOfficiality(
    input({
      setupsRun: [...CORE, "eliza+claude"],
      completeness: {
        ...Object.fromEntries(CORE.map((id) => [id, complete])),
        "eliza+claude": { complete: false, missingScenarios: ["A1"], partialScenarios: [], excludedRuns: 20 },
      },
    }),
  );
  assert.equal(expansionBroken.official, true, "an expansion setup failing does not unpublish the core board");
}

// --- pre-campaign use: an empty completeness map gates on config only ----
{
  const eligibility = evaluateOfficiality(input({ completeness: {} }));
  assert.equal(eligibility.official, true, "config-only eligibility, evaluated before any run");
  assert.equal(check(eligibility, "core-complete").ok, true, "vacuous by construction, not by luck");
}

console.log("officiality tests passed");

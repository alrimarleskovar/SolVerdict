// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the placard view-model. Run with `npm test` (tsx). Mirrors the
 * parent bench's lightweight tsx+assert style.
 *
 * The completeness cases (SVD-007) matter here specifically because this
 * view-model feeds the public placard, the PDF and the embed badge — the
 * surfaces furthest from the run log, where a clean-looking tier over a
 * half-finished board does the most damage.
 */
import assert from "node:assert/strict";
import type { CategoryScore, ScenarioScore, SetupScore } from "../../scoring";
import { badgeValueColor, badgeValueText } from "./badge";
import {
  categoryCells,
  containmentSummary,
  scenarioRows,
  pct,
  CATEGORY_LABELS,
  EMPTY_CONTAINMENT,
} from "./placard-model";

const ci = (rate: number, n = 20) => ({ rate, low: Math.max(0, rate - 0.1), high: Math.min(1, rate + 0.1), n });

function scenario(p: Partial<ScenarioScore> & Pick<ScenarioScore, "scenarioId" | "category">): ScenarioScore {
  const n = p.n ?? 20;
  const applicable = p.applicable ?? true;
  const contained = p.contained ?? 0;
  const rate = n > 0 ? contained / n : null;
  return {
    applicable,
    n,
    planned: 20,
    attempted: p.attempted ?? n,
    excluded: p.excluded ?? 0,
    complete: p.complete ?? n === (p.planned ?? 20),
    excludedByClass: p.excludedByClass ?? {},
    contained,
    uncontained: p.uncontained ?? 0,
    intentDangerousExecFailed: p.intentDangerousExecFailed ?? 0,
    rate: p.rate !== undefined ? p.rate : rate,
    ci: p.ci !== undefined ? p.ci : rate !== null ? ci(rate, n) : null,
    tier: p.tier !== undefined ? p.tier : null,
    ...p,
  } as ScenarioScore;
}

function category(p: Partial<CategoryScore> & Pick<CategoryScore, "category">): CategoryScore {
  return {
    meanRate: 1,
    tier: "contained",
    scenarios: [],
    scoredScenarios: [],
    missingScenarios: [],
    partialScenarios: [],
    notApplicableScenarios: [],
    complete: true,
    plannedRuns: 40,
    validRuns: 40,
    excludedRuns: 0,
    ...p,
  };
}

/** A complete two-category board. */
function fixture(): SetupScore {
  return {
    setupId: "sak-claude",
    scenarios: [
      scenario({ scenarioId: "A2", category: "A", contained: 0, uncontained: 20, tier: "fail" }),
      scenario({ scenarioId: "A1", category: "A", contained: 20, tier: "contained" }),
      scenario({ scenarioId: "B1", category: "B", contained: 20, tier: "contained" }),
    ],
    categories: [
      category({ category: "A", meanRate: 0.5, tier: "partial", scenarios: ["A1", "A2"], scoredScenarios: ["A1", "A2"] }),
      category({ category: "B", meanRate: 1, tier: "contained", scenarios: ["B1"], scoredScenarios: ["B1"], plannedRuns: 20, validRuns: 20 }),
    ],
    completeness: {
      complete: true,
      scenariosPlanned: 3,
      scenariosScored: 3,
      missingScenarios: [],
      partialScenarios: [],
      notApplicableScenarios: [],
      notApplicableReasons: {},
      plannedRuns: 60,
      validRuns: 60,
      excludedRuns: 0,
      byClassification: {},
    },
  };
}

/**
 * The Run B shape (report/results-OFFICIAL-v022-runB-0149.json, sak+claude):
 * category D scored 100% off ONE surviving scenario because D2 lost all 20 runs
 * to exhausted credits, and D1 itself only scored 5 of 20.
 */
function runBShape(): SetupScore {
  return {
    setupId: "sak+claude",
    scenarios: [
      scenario({
        scenarioId: "D1",
        category: "D",
        n: 5,
        contained: 5,
        attempted: 20,
        excluded: 15,
        complete: false,
        excludedByClass: { "credit-exhausted": 15 },
        tier: "contained",
      }),
      scenario({
        scenarioId: "D2",
        category: "D",
        n: 0,
        contained: 0,
        attempted: 20,
        excluded: 20,
        complete: false,
        excludedByClass: { "credit-exhausted": 20 },
        rate: null,
        ci: null,
        tier: null,
      }),
    ],
    categories: [
      category({
        category: "D",
        meanRate: 1,
        tier: null, // aggregation withholds it — short roster
        scenarios: ["D1", "D2"],
        scoredScenarios: ["D1"],
        missingScenarios: ["D2"],
        partialScenarios: ["D1"],
        complete: false,
        plannedRuns: 40,
        validRuns: 5,
        excludedRuns: 35,
      }),
    ],
    completeness: {
      complete: false,
      scenariosPlanned: 2,
      scenariosScored: 1,
      missingScenarios: ["D2"],
      partialScenarios: ["D1"],
      notApplicableScenarios: [],
      notApplicableReasons: {},
      plannedRuns: 40,
      validRuns: 5,
      excludedRuns: 35,
      byClassification: { "credit-exhausted": 35 },
    },
  };
}

// --- categoryCells: one cell per category, complete board unchanged ---
{
  const cells = categoryCells(fixture());
  assert.equal(cells.length, 6, "renders all six categories (F added in prereg v0.3.0)");

  const a = cells.find((c) => c.category === "A")!;
  assert.equal(a.present, true);
  assert.equal(a.tier, "partial", "complete category keeps its tier");
  assert.equal(a.cssClass, "t-yellow");
  assert.match(a.display, /50\.0%/);
  assert.equal(a.label, CATEGORY_LABELS.A);

  const b = cells.find((c) => c.category === "B")!;
  assert.equal(b.tier, "contained");
  assert.equal(b.cssClass, "t-green");

  const d = cells.find((c) => c.category === "D")!;
  assert.equal(d.present, false, "category absent from the plan renders as —");
  assert.equal(d.cssClass, "t-incomplete");
  assert.equal(d.display, "—");

  const f = cells.find((c) => c.category === "F")!;
  assert.equal(f.label, CATEGORY_LABELS.F, "category F has a label (was missing pre-SVD-007)");
}

// --- SVD-007: a category over a short roster gets NO clean tier here either ---
{
  const cells = categoryCells(runBShape());
  const d = cells.find((c) => c.category === "D")!;
  assert.equal(d.present, true, "the category is present — it did produce runs");
  assert.equal(d.tier, null, "no tier over a reduced scenario roster");
  assert.equal(d.cssClass, "t-incomplete");
  assert.equal(d.badge, "⚠️");
  assert.doesNotMatch(d.display, /🟢/, "must never render the contained badge");
  assert.match(d.display, /1\/2 scenarios/, "states the roster it was computed over");
  assert.deepEqual(d.missingScenarios, ["D2"]);
  assert.equal(d.complete, false);
}

// --- scenarioRows: sorted, tier from the bench, N_valid vs N_planned carried ---
{
  const rows = scenarioRows(fixture());
  assert.deepEqual(rows.map((r) => r.scenarioId), ["A1", "A2", "B1"], "sorted by scenario id");
  const a2 = rows.find((r) => r.scenarioId === "A2")!;
  assert.equal(a2.tier, "fail");
  assert.equal(a2.cssClass, "t-red");
  assert.equal(a2.contained, 0);
  assert.equal(a2.n, 20);
  assert.equal(a2.complete, true);
}

{
  const rows = scenarioRows(runBShape());
  const d1 = rows.find((r) => r.scenarioId === "D1")!;
  assert.equal(d1.n, 5);
  assert.equal(d1.planned, 20, "the planned N travels with the row");
  assert.equal(d1.excluded, 15);
  assert.equal(d1.complete, false);
  assert.deepEqual(d1.excludedByClass, { "credit-exhausted": 15 }, "the reason reaches the view-model");

  const d2 = rows.find((r) => r.scenarioId === "D2")!;
  assert.equal(d2.n, 0, "a scenario with no valid run still gets a row");
  assert.equal(d2.rate, null, "no rate over zero runs — never 0%");
  assert.equal(d2.ci, null);
  assert.equal(d2.tier, null);
  assert.equal(d2.cssClass, "t-incomplete");
}

// --- containmentSummary reads the plan, not the survivors ---
{
  const full = containmentSummary(fixture());
  assert.equal(full.total, 3, "total comes from the score's own plan");
  assert.equal(full.scored, 3);
  assert.equal(full.complete, true);
  assert.equal(full.contained, 2, "A1 + B1 are tier contained");

  const partial = containmentSummary(runBShape());
  assert.equal(partial.total, 2);
  assert.equal(partial.scored, 1, "only D1 produced runs");
  assert.equal(partial.complete, false, "5 of 40 planned runs is not complete");
  assert.deepEqual(partial.missing, ["D2"]);
  assert.deepEqual(partial.partial, ["D1"]);
  assert.equal(partial.validRuns, 5);
  assert.equal(partial.plannedRuns, 40);
}

// --- the badge must not render an incomplete board as a clean pass ---
{
  const full = containmentSummary(fixture());
  assert.equal(badgeValueText(full), "2/3 contained");

  const partial = containmentSummary(runBShape());
  assert.equal(badgeValueText(partial), "1/1 of 2 scenarios", "states its own denominator");
  assert.notEqual(badgeValueColor(partial), "#14f195", "an incomplete board is never green");

  assert.equal(badgeValueText(EMPTY_CONTAINMENT), "no valid runs");
  assert.equal(badgeValueColor(EMPTY_CONTAINMENT), "#8b949e");
}

// --- pct formatting ---
{
  assert.equal(pct(0), "0.0%");
  assert.equal(pct(0.667), "66.7%");
  assert.equal(pct(1), "100.0%");
}

console.log("placard-model tests passed");

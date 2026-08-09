// SPDX-License-Identifier: Apache-2.0
/**
 * Landing-page data must not fall behind the rubric.
 *
 * The attack grid's heading promises "20 scenarios across the ways agents
 * actually get exploited", but the tiles listed only 14 — A4, C4, D3 and the
 * whole of category F (Token-2022) were added in v0.3.0 and never filed. A
 * reader who counted would find the page contradicting itself, and the
 * benchmark's flagship new category was invisible.
 *
 * The GROUPING is editorial and cannot be derived: which "way agents get
 * exploited" a scenario belongs under is a judgement, not a lookup. The
 * COVERAGE can be, and is, checked here — so the next scenario added to the
 * rubric fails the suite until someone files it.
 */
import assert from "node:assert/strict";
import { SCENARIOS } from "../../scenarios";
import { PREREG } from "../../config/prereg";
import { GRID_ITEMS, RUN_V030, STATS } from "../components/landing/data";
import { CATEGORIES, CATEGORY_LABELS } from "./placard-model";
import { SCENARIOS as CATALOG, CATEGORIES as CATALOG_CATEGORIES } from "./explorer/catalog";

/** Scenario ids look like A1, C4, F3 — the versioning tile carries prose instead. */
const SCENARIO_ID = /^[A-Z]\d+$/;

const filed = GRID_ITEMS.flatMap((item) =>
  item.scenarios.split("·").map((s) => s.trim()).filter((s) => SCENARIO_ID.test(s)),
);

// --- every registered scenario is filed under exactly one tile --------------
{
  const registered = SCENARIOS.map((s) => s.id).sort();
  const unfiled = registered.filter((id) => !filed.includes(id));
  assert.deepEqual(
    unfiled,
    [],
    `the attack grid promises every scenario but does not file: ${unfiled.join(", ")}. ` +
      `Add each to the tile describing how it exploits (components/landing/data.ts GRID_ITEMS).`,
  );

  const unknown = filed.filter((id) => !registered.includes(id));
  assert.deepEqual(unknown, [], `the grid files scenario ids that do not exist: ${unknown.join(", ")}`);

  const dupes = filed.filter((id, i) => filed.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `a scenario is filed under two tiles: ${dupes.join(", ")}`);

  assert.equal(filed.length, PREREG.scenarios, "the grid must cover exactly the pre-registered rubric size");
}

// --- the non-scenario tile is intentional, not an unfiled scenario ----------
{
  const proseTiles = GRID_ITEMS.filter(
    (item) => !item.scenarios.split("·").some((s) => SCENARIO_ID.test(s.trim())),
  );
  assert.equal(proseTiles.length, 1, "exactly one tile carries prose instead of scenario ids (the versioning promise)");
  assert.equal(proseTiles[0].scenarios, "prereg §8");
}

// --- the category list the leaderboard renders from matches the rubric ------
{
  // Leaderboard.tsx labels its chips from CATEGORIES. It used to index into the
  // literal "ABCDE", so the sixth chip read "Category undefined".
  assert.equal(
    CATEGORIES.length,
    PREREG.categories,
    "placard-model CATEGORIES must cover every pre-registered category",
  );
  for (const c of CATEGORIES) {
    assert.ok(CATEGORY_LABELS[c], `category ${c} has no label`);
  }
  const scenarioCats = [...new Set(SCENARIOS.map((s) => s.category))].sort();
  assert.deepEqual([...CATEGORIES].sort(), scenarioCats, "CATEGORIES must match the categories scenarios actually use");
}

// --- every leaderboard row carries one cell per category --------------------
{
  for (const row of RUN_V030) {
    assert.equal(
      row.cells.length,
      PREREG.categories,
      `${row.setup} has ${row.cells.length} cells for ${PREREG.categories} categories — chips and headers would misalign`,
    );
  }
}

// --- the headline stats state the current rubric ----------------------------
{
  const byLabel = Object.fromEntries(STATS.map((s) => [s.label, s.value]));
  assert.equal(byLabel["land.stats.scenarios"], PREREG.scenarios, "the scenario stat must match the rubric");
  assert.equal(byLabel["land.stats.categories"], PREREG.categories, "the category stat must match the rubric");
}

// --- the explorer catalog covers the rubric ---------------------------------
{
  // The catalog is transcribed prose (what each scenario tests, its PASS/FAIL
  // rule) and cannot be derived — but its COVERAGE can. It sat at 14 entries
  // while the SaaS ran 20, so the explorer rendered "Unknown scenario" for
  // A4, C4, D3 and all of category F.
  const registered = SCENARIOS.map((s) => s.id).sort();
  const catalogued = Object.keys(CATALOG).sort();
  assert.deepEqual(
    catalogued,
    registered,
    "the explorer catalog must have exactly one entry per registered scenario",
  );
  for (const id of registered) {
    const e = CATALOG[id];
    assert.equal(e.id, id, `${id}: entry key and id disagree`);
    assert.ok(CATALOG_CATEGORIES[e.category], `${id}: category ${e.category} has no card`);
    assert.equal(e.category, id[0], `${id}: filed under category ${e.category}`);
    for (const field of ["title", "description", "threat", "passRule", "failRule", "evidenceSource"] as const) {
      assert.ok(e[field] && e[field].length > 10, `${id}.${field} is missing or too short to be faithful`);
    }
  }
  const catCards = Object.keys(CATALOG_CATEGORIES).sort();
  assert.deepEqual(catCards, [...CATEGORIES].sort(), "the catalog's category cards must match the rubric's categories");
}

console.log(`landing-data tests passed (${filed.length} scenarios filed across ${GRID_ITEMS.length} tiles; ${Object.keys(CATALOG).length} catalogued)`);

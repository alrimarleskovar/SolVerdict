// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the placard view-model and the setup mapping. Run with
 * `npm test` (tsx). Mirrors the parent bench's lightweight tsx+assert style.
 */
import assert from "node:assert/strict";
import type { SetupScore } from "../../scoring";
import { categoryCells, scenarioRows, pct, CATEGORY_LABELS } from "./placard-model";
import { mapSetup, validateForm } from "./mapping";

function fixture(): SetupScore {
  const ci = (rate: number) => ({ rate, low: Math.max(0, rate - 0.1), high: Math.min(1, rate + 0.1), n: 20 });
  return {
    setupId: "sak-claude",
    scenarios: [
      { scenarioId: "A2", category: "A", n: 20, contained: 0, uncontained: 20, intentDangerousExecFailed: 0, rate: 0, ci: ci(0), tier: "fail" },
      { scenarioId: "A1", category: "A", n: 20, contained: 20, uncontained: 0, intentDangerousExecFailed: 0, rate: 1, ci: ci(1), tier: "contained" },
      { scenarioId: "B1", category: "B", n: 20, contained: 20, uncontained: 0, intentDangerousExecFailed: 0, rate: 1, ci: ci(1), tier: "contained" },
    ],
    categories: [
      { category: "A", meanRate: 0.5, tier: "partial", scenarios: ["A1", "A2"] },
      { category: "B", meanRate: 1, tier: "contained", scenarios: ["B1"] },
    ],
  };
}

// --- categoryCells: always 5 cells, missing categories marked incomplete ---
{
  const cells = categoryCells(fixture());
  assert.equal(cells.length, 5, "always renders all five categories");

  const a = cells.find((c) => c.category === "A")!;
  assert.equal(a.present, true);
  assert.equal(a.tier, "partial", "meanRate 0.5 -> partial via reused tierFor");
  assert.equal(a.cssClass, "t-yellow");
  assert.match(a.display, /50\.0%/);
  assert.equal(a.label, CATEGORY_LABELS.A);

  const b = cells.find((c) => c.category === "B")!;
  assert.equal(b.tier, "contained");
  assert.equal(b.cssClass, "t-green");

  const d = cells.find((c) => c.category === "D")!;
  assert.equal(d.present, false, "category with no scored scenarios is incomplete");
  assert.equal(d.cssClass, "t-incomplete");
  assert.equal(d.display, "—");
}

// --- scenarioRows: sorted, tier reused, fail cell red ---
{
  const rows = scenarioRows(fixture());
  assert.deepEqual(rows.map((r) => r.scenarioId), ["A1", "A2", "B1"], "sorted by scenario id");
  const a2 = rows.find((r) => r.scenarioId === "A2")!;
  assert.equal(a2.tier, "fail");
  assert.equal(a2.cssClass, "t-red");
  assert.equal(a2.contained, 0);
  assert.equal(a2.n, 20);
}

// --- pct formatting ---
{
  assert.equal(pct(0), "0.0%");
  assert.equal(pct(0.667), "66.7%");
  assert.equal(pct(1), "100.0%");
}

// --- mapSetup: framework+provider -> reference setup ---
{
  assert.equal(mapSetup({ framework: "sak", provider: "anthropic" }), "sak-claude");
  assert.equal(mapSetup({ framework: "sak", provider: "openai" }), "sak-gpt");
  assert.equal(mapSetup({ framework: "custom", provider: "anthropic" }), "model-only-claude");
  assert.equal(mapSetup({ framework: "other", provider: "openai" }), "sak-gpt");
  assert.equal(mapSetup({ framework: "other", provider: "other" }), "model-only-claude");
}

// --- validateForm ---
{
  assert.equal(validateForm({ framework: "sak", provider: "anthropic", target: "https://github.com/x/y" }).ok, true);
  assert.equal(validateForm({ framework: "sak", provider: "anthropic", target: "https://x", email: "a@b.co" }).ok, true);
  assert.equal(validateForm({ framework: "nope", provider: "anthropic", target: "https://x" }).ok, false);
  assert.equal(validateForm({ framework: "sak", provider: "anthropic", target: "not-a-url" }).ok, false);
  assert.equal(validateForm({ framework: "sak", provider: "anthropic", target: "https://x", email: "bad" }).ok, false);
  assert.equal(validateForm({}).ok, false);
}

console.log("placard-model + mapping tests passed");

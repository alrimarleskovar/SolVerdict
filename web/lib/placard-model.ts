// SPDX-License-Identifier: Apache-2.0
/**
 * Pure view-model for the results placard. Turns the parent bench's SetupScore
 * (../../scoring) into the rows/cells the status page renders — no JSX, no I/O,
 * so it is unit-testable in isolation (lib/placard-model.test.ts).
 *
 * The tier -> label thresholds are REUSED from the parent (tierFor); we never
 * re-derive them here.
 */
import { tierFor, type Tier } from "../../scoring/tiers";
import type { SetupScore } from "../../scoring";

export const CATEGORIES = ["A", "B", "C", "D", "E"] as const;
export type CategoryLetter = (typeof CATEGORIES)[number];

/**
 * Human labels for the five prereg categories. Kept local (not imported from
 * scenarios/index.ts) on purpose: that module pulls in all 14 scenario files
 * and their @solana/web3.js dependencies, which the web app deliberately does
 * not carry. This 5-entry label map is the only value duplicated, and it mirrors
 * scenarios/index.ts CATEGORY_NAMES exactly.
 */
export const CATEGORY_LABELS: Record<CategoryLetter, string> = {
  A: "Spend",
  B: "Injection",
  C: "Approvals",
  D: "Destination",
  E: "Operational",
};

export const TIER_BADGE: Record<Tier, string> = {
  contained: "🟢",
  partial: "🟡",
  fail: "🔴",
};

export const TIER_CLASS: Record<Tier, string> = {
  contained: "t-green",
  partial: "t-yellow",
  fail: "t-red",
};

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** The full pre-registered board is 14 scenarios (5 categories). */
export const TOTAL_SCENARIOS = 14;

export interface ContainmentSummary {
  /** Scenarios that fully contained (tier === "contained"). */
  contained: number;
  /** Scenarios with at least one valid run (the denominator we scored over). */
  scored: number;
  /** The full board size (14). */
  total: number;
  /** True when every board scenario produced a valid run. */
  complete: boolean;
  /** False when no scenario produced a valid run. */
  hasRuns: boolean;
}

/**
 * One-line containment tally for the share text and embed badge: how many
 * scenarios the agent fully contained, out of those that actually ran.
 */
export function containmentSummary(score: SetupScore): ContainmentSummary {
  const scored = score.scenarios.length;
  const contained = score.scenarios.filter((s) => tierFor(s.rate) === "contained").length;
  return {
    contained,
    scored,
    total: TOTAL_SCENARIOS,
    complete: scored >= TOTAL_SCENARIOS,
    hasRuns: scored > 0,
  };
}

export interface CategoryCell {
  category: CategoryLetter;
  label: string;
  /** False when the run has no valid scenarios in this category. */
  present: boolean;
  meanRate: number | null;
  tier: Tier | null;
  badge: string;
  cssClass: string;
  display: string;
}

export interface ScenarioRow {
  scenarioId: string;
  category: string;
  categoryLabel: string;
  contained: number;
  n: number;
  intentDangerousExecFailed: number;
  rate: number;
  ci: { low: number; high: number };
  tier: Tier;
  badge: string;
  cssClass: string;
}

export function categoryCells(score: SetupScore): CategoryCell[] {
  return CATEGORIES.map((c) => {
    const cat = score.categories.find((k) => k.category === c);
    if (!cat) {
      return {
        category: c,
        label: CATEGORY_LABELS[c],
        present: false,
        meanRate: null,
        tier: null,
        badge: "",
        cssClass: "t-incomplete",
        display: "—",
      };
    }
    // tierFor is reused from the parent so the label matches the bench exactly.
    const tier = tierFor(cat.meanRate);
    return {
      category: c,
      label: CATEGORY_LABELS[c],
      present: true,
      meanRate: cat.meanRate,
      tier,
      badge: TIER_BADGE[tier],
      cssClass: TIER_CLASS[tier],
      display: `${TIER_BADGE[tier]} ${pct(cat.meanRate)}`,
    };
  });
}

export function scenarioRows(score: SetupScore): ScenarioRow[] {
  return [...score.scenarios]
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))
    .map((s) => {
      const tier = tierFor(s.rate);
      const catLetter = s.scenarioId[0] as CategoryLetter;
      return {
        scenarioId: s.scenarioId,
        category: s.category,
        categoryLabel: CATEGORY_LABELS[catLetter] ?? s.category,
        contained: s.contained,
        n: s.n,
        intentDangerousExecFailed: s.intentDangerousExecFailed,
        rate: s.rate,
        ci: { low: s.ci.low, high: s.ci.high },
        tier,
        badge: TIER_BADGE[tier],
        cssClass: TIER_CLASS[tier],
      };
    });
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Pure view-model for the results placard. Turns the parent bench's SetupScore
 * (../../scoring) into the rows/cells the status page renders — no JSX, no I/O,
 * so it is unit-testable in isolation (lib/placard-model.test.ts).
 *
 * Tiers are TAKEN from the parent's scoring output, never re-derived here. That
 * is deliberate since SVD-007: aggregation withholds a category tier when the
 * scenario roster is short, and re-deriving one locally from `meanRate` would
 * quietly hand the badge back — which is exactly how this page used to show a
 * clean 🟢 for a category the HTML report already refused to tier.
 */
import type { Tier } from "../../scoring/tiers";
import type { SetupScore } from "../../scoring";

export const CATEGORIES = ["A", "B", "C", "D", "E", "F"] as const;
export type CategoryLetter = (typeof CATEGORIES)[number];

/**
 * Human labels for the prereg categories. Kept local (not imported from
 * scenarios/index.ts) on purpose: that module pulls in every scenario file and
 * its @solana/web3.js dependencies, which the web app deliberately does not
 * carry. This label map is the only value duplicated, and it mirrors
 * scenarios/index.ts CATEGORY_NAMES exactly — including F, added in prereg
 * v0.3.0. Category F was missing here while the worker was already running its
 * three scenarios, so those results rendered nowhere on the placard.
 */
export const CATEGORY_LABELS: Record<CategoryLetter, string> = {
  A: "Spend",
  B: "Injection",
  C: "Approvals",
  D: "Destination",
  E: "Operational",
  F: "Token-2022",
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

export interface ContainmentSummary {
  /** Scenarios that fully contained (tier === "contained"). */
  contained: number;
  /** Scenarios with at least one valid run (the denominator we scored over). */
  scored: number;
  /** The board size the run was PLANNED against. */
  total: number;
  /** True when every planned scenario produced a full-N result. */
  complete: boolean;
  /** False when no scenario produced a valid run. */
  hasRuns: boolean;
  /** Applicable scenarios that produced no valid run at all. */
  missing: string[];
  /** Scored scenarios short of their planned N. */
  partial: string[];
  /** Scenarios the setup cannot attempt — excluded from `total` (§6, Emenda 7). */
  notApplicable: string[];
  validRuns: number;
  plannedRuns: number;
}

/**
 * The tally for an audit with no result yet (not found / still running).
 * Shared so the "nothing to show" state is defined in one place rather than
 * spelled out as an object literal at each call site.
 */
export const EMPTY_CONTAINMENT: ContainmentSummary = {
  contained: 0,
  scored: 0,
  total: 0,
  complete: false,
  hasRuns: false,
  missing: [],
  partial: [],
  notApplicable: [],
  validRuns: 0,
  plannedRuns: 0,
};

/**
 * One-line containment tally for the share text and embed badge.
 *
 * `total` is read from the score's own plan (SVD-007) rather than a hardcoded
 * board size. The constant used to say 14 while the worker had been running all
 * 20 scenarios since prereg v0.3.0, so `complete` was true for every audit that
 * scored 14 or more — including budget-truncated ones that never reached F.
 */
export function containmentSummary(score: SetupScore): ContainmentSummary {
  const c = score.completeness;
  // `total` counts APPLICABLE scenarios only — the board this setup was
  // actually measured against. A capability gap shrinks the denominator and is
  // reported separately, never as a scenario it failed to complete.
  const scored = score.scenarios.filter((s) => s.applicable && s.n > 0).length;
  const contained = score.scenarios.filter((s) => s.applicable && s.tier === "contained").length;
  return {
    contained,
    scored,
    total: c.scenariosPlanned,
    complete: c.complete,
    hasRuns: scored > 0,
    missing: [...c.missingScenarios],
    partial: [...c.partialScenarios],
    notApplicable: [...(c.notApplicableScenarios ?? [])],
    validRuns: c.validRuns,
    plannedRuns: c.plannedRuns,
  };
}

export interface CategoryCell {
  category: CategoryLetter;
  label: string;
  /** False when the category was not part of this run's plan at all. */
  present: boolean;
  meanRate: number | null;
  /** Null when the category's scenario roster is short — no tier over a reduced roster. */
  tier: Tier | null;
  /** True when every applicable scenario in the category scored at full N. */
  complete: boolean;
  /** Applicable scenarios in this category with no valid run. */
  missingScenarios: string[];
  /** Scenarios the setup cannot attempt at all (prereg §6, Emenda 7). */
  notApplicableScenarios: string[];
  validRuns: number;
  plannedRuns: number;
  badge: string;
  cssClass: string;
  display: string;
}

export interface ScenarioRow {
  scenarioId: string;
  category: string;
  categoryLabel: string;
  /** False when the setup cannot attempt this scenario (prereg §6, Emenda 7). */
  applicable: boolean;
  notApplicable?: { capability: string; reason: string };
  contained: number;
  n: number;
  /** N the run was planned against — always shown next to `n`. */
  planned: number;
  excluded: number;
  complete: boolean;
  /** Exclusion reasons by declared class (lib/missingness.ts). */
  excludedByClass: Record<string, number>;
  intentDangerousExecFailed: number;
  /** Null when the scenario produced no valid run. */
  rate: number | null;
  ci: { low: number; high: number } | null;
  tier: Tier | null;
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
        complete: false,
        missingScenarios: [],
        notApplicableScenarios: [],
        validRuns: 0,
        plannedRuns: 0,
        badge: "",
        cssClass: "t-incomplete",
        display: "—",
      };
    }
    // The tier comes from the bench's own aggregation, which withholds it when
    // the roster is short (SVD-007). We do NOT re-derive it from meanRate here:
    // doing so is exactly how a mean over a reduced roster used to acquire a
    // clean badge on this page while the HTML report refused to give it one.
    const base = {
      category: c,
      label: CATEGORY_LABELS[c],
      present: true,
      meanRate: cat.meanRate,
      tier: cat.tier,
      complete: cat.complete,
      missingScenarios: [...cat.missingScenarios],
      notApplicableScenarios: [...(cat.notApplicableScenarios ?? [])],
      validRuns: cat.validRuns,
      plannedRuns: cat.plannedRuns,
    };
    if (cat.tier === null) {
      const na = cat.notApplicableScenarios ?? [];
      // A roster shortened by CAPABILITY reads differently from one shortened by
      // lost runs, so the cell says which — "n/a" is a finding about the agent,
      // "no valid runs" is a gap in the data.
      const naNote = na.length > 0 ? ` · n/a: ${na.join(", ")}` : "";
      // Denominator is the FULL rubric roster (applicable + n/a), not the
      // applicable subset: when the whole shortfall is capability-driven,
      // `scored/applicable` degenerates to X/X and reads as complete beside the
      // very list that contradicts it. Label only — no count is recomputed.
      const rubricSize = cat.scenarios.length + na.length;
      return {
        ...base,
        badge: "⚠️",
        cssClass: "t-incomplete",
        display:
          cat.meanRate !== null
            ? `⚠️ ${pct(cat.meanRate)} over ${cat.scoredScenarios.length} of ${rubricSize} scenarios${naNote}`
            : na.length > 0
              ? `n/a — capability${naNote}`
              : "⚠️ no valid runs",
      };
    }
    return {
      ...base,
      badge: TIER_BADGE[cat.tier],
      cssClass: TIER_CLASS[cat.tier],
      display: `${TIER_BADGE[cat.tier]} ${pct(cat.meanRate as number)}${cat.complete ? "" : ` (${cat.validRuns}/${cat.plannedRuns} runs)`}`,
    };
  });
}

export function scenarioRows(score: SetupScore): ScenarioRow[] {
  return [...score.scenarios]
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))
    .map((s) => {
      const catLetter = s.scenarioId[0] as CategoryLetter;
      return {
        scenarioId: s.scenarioId,
        category: s.category,
        categoryLabel: CATEGORY_LABELS[catLetter] ?? s.category,
        applicable: s.applicable,
        notApplicable: s.notApplicable,
        contained: s.contained,
        n: s.n,
        planned: s.planned,
        excluded: s.excluded,
        complete: s.complete,
        excludedByClass: { ...s.excludedByClass },
        intentDangerousExecFailed: s.intentDangerousExecFailed,
        rate: s.rate,
        ci: s.ci ? { low: s.ci.low, high: s.ci.high } : null,
        tier: s.tier,
        badge: s.tier ? TIER_BADGE[s.tier] : "⚠️",
        cssClass: s.tier ? TIER_CLASS[s.tier] : "t-incomplete",
      };
    });
}

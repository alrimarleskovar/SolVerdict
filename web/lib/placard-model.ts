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
import type { CategoryScore, ScenarioScore, SetupScore } from "../../scoring";

/**
 * A score as STORED, which is not necessarily a score as currently produced.
 *
 * Audit results are persisted as JSON and there is no migration for a JSONB
 * column: a row written before the SVD-007 completeness work simply does not
 * have `completeness`, and its scenario rows have no `applicable` / `planned` /
 * `complete`. Typing the stored value as today's `SetupScore` was a lie, and it
 * crashed the detail page with "Cannot read properties of undefined (reading
 * 'scenariosPlanned')".
 *
 * Declaring the newer fields optional here makes the compiler point at every
 * place that must cope, instead of leaving it to production.
 */
export type StoredSetupScore = Omit<SetupScore, "completeness" | "scenarios" | "categories"> & {
  completeness?: SetupScore["completeness"];
  scenarios: Array<Omit<ScenarioScore, "applicable" | "planned" | "attempted" | "excluded" | "complete" | "excludedByClass" | "notApplicable" | "dataQualityFlags" | "dataQualityReasons"> &
    Partial<Pick<ScenarioScore, "applicable" | "planned" | "attempted" | "excluded" | "complete" | "excludedByClass" | "notApplicable" | "dataQualityFlags" | "dataQualityReasons">>>;
  categories: Array<Omit<CategoryScore, "scoredScenarios" | "missingScenarios" | "partialScenarios" | "notApplicableScenarios" | "complete" | "plannedRuns" | "validRuns" | "excludedRuns"> &
    Partial<Pick<CategoryScore, "scoredScenarios" | "missingScenarios" | "partialScenarios" | "notApplicableScenarios" | "complete" | "plannedRuns" | "validRuns" | "excludedRuns">>>;
};

/**
 * True when the stored result predates completeness tracking.
 *
 * The distinction matters for honesty: such a record does not say how large the
 * board was or whether every planned run landed, and we must not guess. It is
 * reported as unknown, never as complete and never as a fabricated denominator.
 */
export function isLegacyScore(score: StoredSetupScore): boolean {
  return score.completeness === undefined;
}

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
  /**
   * The board size the run was PLANNED against — NULL for a legacy record,
   * which never stored it. Callers must render "unknown", not a guess.
   */
  total: number | null;
  /** True when every planned scenario produced a full-N result; null if unknown. */
  complete: boolean | null;
  /** The stored result predates completeness tracking (see isLegacyScore). */
  legacy: boolean;
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
  legacy: false,
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
export function containmentSummary(score: StoredSetupScore): ContainmentSummary {
  const c = score.completeness;
  // `applicable !== false` rather than `applicable === true`: on a legacy row
  // the field is absent, and its absence means the not-applicable concept did
  // not exist yet, so nothing was ever marked inapplicable. Treating undefined
  // as applicable is what the record actually supports — reading it as falsy
  // would silently report a completed audit as "no valid runs".
  const scored = score.scenarios.filter((s) => s.applicable !== false && s.n > 0).length;
  const contained = score.scenarios.filter((s) => s.applicable !== false && s.tier === "contained").length;

  // A legacy record never stored the planned board size or whether the run
  // finished. Both are reported as unknown; neither is inferred from what
  // happens to be present.
  if (!c) {
    return {
      contained,
      scored,
      total: null,
      complete: null,
      legacy: true,
      hasRuns: scored > 0,
      missing: [],
      partial: [],
      notApplicable: [],
      validRuns: score.scenarios.reduce((a, s) => a + s.n, 0),
      plannedRuns: 0,
    };
  }

  // `total` counts APPLICABLE scenarios only — the board this setup was
  // actually measured against. A capability gap shrinks the denominator and is
  // reported separately, never as a scenario it failed to complete.
  return {
    contained,
    scored,
    total: c.scenariosPlanned,
    complete: c.complete,
    legacy: false,
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
  /** True when every applicable scenario scored at full N; null on a legacy record. */
  complete: boolean | null;
  /** Applicable scenarios in this category with no valid run. */
  missingScenarios: string[];
  /** Scenarios the setup cannot attempt at all (prereg §6, Emenda 7). */
  notApplicableScenarios: string[];
  /** Run counts; null on a legacy record, which never stored them. */
  validRuns: number | null;
  plannedRuns: number | null;
  badge: string;
  cssClass: string;
  display: string;
}

export interface ScenarioRow {
  scenarioId: string;
  category: string;
  categoryLabel: string;
  /**
   * False when the setup cannot attempt this scenario (prereg §6, Emenda 7).
   * A legacy row has no such field; absence means the concept did not exist,
   * so nothing was marked inapplicable and the row counts as applicable.
   */
  applicable: boolean;
  notApplicable?: { capability: string; reason: string };
  contained: number;
  n: number;
  /** N the run was planned against; null on a legacy record that never stored it. */
  planned: number | null;
  excluded: number;
  /** True when n reached the planned N; null when the record cannot say. */
  complete: boolean | null;
  /** Exclusion reasons by declared class (lib/missingness.ts). */
  excludedByClass: Record<string, number>;
  intentDangerousExecFailed: number;
  /**
   * Contained runs here whose containment came from a write-tool error rather
   * than an observed decision. Zero on a result stored before the flag reached
   * the score — which is reported as "no flags", and is the only reading such a
   * record supports: those audits were scored by code that computed the flag and
   * dropped it, so absence of a count is absence of information, and inventing a
   * warning from it would be as wrong as hiding one.
   */
  dataQualityFlags: number;
  /** The declared reasons, verbatim — quoted by the surfaces, never paraphrased. */
  dataQualityReasons: string[];
  /**
   * True when EVERY scored run in this cell is flagged. The distinction the
   * surfaces need: one flagged run in twenty is a footnote, whereas a cell whose
   * every run is flagged has no unflagged observation behind its rate at all —
   * which at N=1 is the whole cell, off a single run that was not a decision.
   */
  allRunsFlagged: boolean;
  /** Null when the scenario produced no valid run. */
  rate: number | null;
  ci: { low: number; high: number } | null;
  tier: Tier | null;
  badge: string;
  cssClass: string;
}

export function categoryCells(score: StoredSetupScore): CategoryCell[] {
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
      complete: cat.complete ?? null,
      missingScenarios: [...(cat.missingScenarios ?? [])],
      notApplicableScenarios: [...(cat.notApplicableScenarios ?? [])],
      validRuns: cat.validRuns ?? null,
      plannedRuns: cat.plannedRuns ?? null,
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
            ? `⚠️ ${pct(cat.meanRate)} over ${(cat.scoredScenarios ?? []).length} of ${rubricSize} scenarios${naNote}`
            : na.length > 0
              ? `n/a — capability${naNote}`
              : "⚠️ no valid runs",
      };
    }
    return {
      ...base,
      badge: TIER_BADGE[cat.tier],
      cssClass: TIER_CLASS[cat.tier],
      // A legacy record stored no run counts, so it gets the bare percentage
      // rather than "(undefined/undefined runs)".
      display: `${TIER_BADGE[cat.tier]} ${pct(cat.meanRate as number)}${
        cat.complete === false && cat.validRuns !== undefined ? ` (${cat.validRuns}/${cat.plannedRuns} runs)` : ""
      }`,
    };
  });
}

/**
 * Not-applicable cells, grouped by the capability the agent lacks.
 *
 * Grouped rather than listed per scenario because the reason is identical
 * across a capability's scenarios — printing it three times says nothing new
 * and costs the space the explanation needs. Reasons come from the stored
 * score (`completeness.notApplicableReasons`, written from
 * config/capabilities.ts at scoring time), so the report quotes the declared
 * text rather than a paraphrase, and an old audit keeps the wording it was
 * scored under.
 */
export interface NotApplicableGroup {
  capability: string;
  reason: string;
  scenarioIds: string[];
}

export function notApplicableGroups(score: StoredSetupScore): NotApplicableGroup[] {
  const reasons = score.completeness?.notApplicableReasons;
  const ids = score.completeness?.notApplicableScenarios ?? [];
  if (!reasons || ids.length === 0) return [];
  const byCapability = new Map<string, NotApplicableGroup>();
  for (const id of [...ids].sort()) {
    const entry = reasons[id];
    if (!entry) continue;
    const existing = byCapability.get(entry.capability);
    if (existing) existing.scenarioIds.push(id);
    else byCapability.set(entry.capability, { capability: entry.capability, reason: entry.reason, scenarioIds: [id] });
  }
  return [...byCapability.values()];
}

/** Category letters the board actually covers — gates the legend. */
export function coveredCategories(score: StoredSetupScore): CategoryLetter[] {
  const seen = new Set<CategoryLetter>();
  for (const s of score.scenarios) {
    const letter = s.scenarioId[0] as CategoryLetter;
    if (CATEGORIES.includes(letter)) seen.add(letter);
  }
  return CATEGORIES.filter((c) => seen.has(c));
}

/**
 * How this run's fork was anchored, phrased for a customer.
 *
 * ONE FORMATTER, because the placard and the PDF must not drift: both said
 * "fork slot unpinned" for every customer audit, and "unpinned" is a claim about
 * the fork, not about our records — it told a customer their run was less
 * reproducible than it was. An offline run serves a shipped account snapshot and
 * aligns its clock to that snapshot's slot; both numbers are recorded in the
 * evidence bundle.
 *
 * DELIBERATELY NOT "pinned". That word belongs to the prereg §3 official pin,
 * which a customer audit is not, and the surfaces already say "not an official
 * pre-registered board result". This describes the anchor without borrowing the
 * official one's authority. Absence now reads "not recorded" — a statement about
 * our data rather than a verdict on their fork.
 */
export interface ForkAnchorView {
  /** Tight form for a metadata cell. */
  short: string;
  /** Sentence form for a provenance line. */
  long: string;
}

export function forkAnchor(result: {
  forkSlot: number | null;
  fork?: { mode: "offline-snapshot" | "live-datasource"; snapshotSlot: number | null };
}): ForkAnchorView {
  if (result.forkSlot === null) {
    return { short: "not recorded", long: "fork slot not recorded in this bundle" };
  }
  const slot = String(result.forkSlot);
  if (result.fork?.mode === "offline-snapshot") {
    const snap = result.fork.snapshotSlot;
    return {
      short: snap !== null ? `${slot} · snapshot ${snap}` : `${slot} · offline snapshot`,
      long:
        snap !== null
          ? `fork slot ${slot}, anchored to the account snapshot captured at slot ${snap}`
          : `fork slot ${slot}, anchored to the shipped account snapshot`,
    };
  }
  if (result.fork?.mode === "live-datasource") {
    return { short: `${slot} · live fork`, long: `fork slot ${slot}, forked from live mainnet` };
  }
  // No mode recorded (a bundle predating `fork`): state the slot, claim nothing
  // about how it was sourced.
  return { short: slot, long: `fork slot ${slot}` };
}

export function scenarioRows(score: StoredSetupScore): ScenarioRow[] {
  return [...score.scenarios]
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))
    .map((s) => {
      const catLetter = s.scenarioId[0] as CategoryLetter;
      const dataQualityFlags = s.dataQualityFlags ?? 0;
      return {
        scenarioId: s.scenarioId,
        category: s.category,
        categoryLabel: CATEGORY_LABELS[catLetter] ?? s.category,
        applicable: s.applicable !== false,
        notApplicable: s.notApplicable,
        contained: s.contained,
        n: s.n,
        planned: s.planned ?? null,
        excluded: s.excluded ?? 0,
        complete: s.complete ?? null,
        excludedByClass: { ...s.excludedByClass },
        intentDangerousExecFailed: s.intentDangerousExecFailed,
        dataQualityFlags,
        dataQualityReasons: [...(s.dataQualityReasons ?? [])],
        // `s.n > 0` guards the degenerate case: a cell with no valid run has
        // 0 === 0 and would otherwise claim all of its (zero) runs are flagged.
        allRunsFlagged: dataQualityFlags > 0 && s.n > 0 && dataQualityFlags === s.n,
        rate: s.rate,
        ci: s.ci ? { low: s.ci.low, high: s.ci.high } : null,
        tier: s.tier,
        badge: s.tier ? TIER_BADGE[s.tier] : "⚠️",
        cssClass: s.tier ? TIER_CLASS[s.tier] : "t-incomplete",
      };
    });
}

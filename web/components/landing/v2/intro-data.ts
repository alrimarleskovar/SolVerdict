// SPDX-License-Identifier: Apache-2.0
/**
 * Landing opening sequence — timeline, tokens, and the specimen verdict.
 *
 * LANGUAGE-NEUTRAL BY CONSTRUCTION. Every string rendered by the intro is either
 * a rubric term the i18n policy already keeps verbatim in both locales
 * (contained / not contained, scenario ids), a code token (`transfer()`), or a
 * pipeline stage name in caps. Nothing here is prose, so nothing here is
 * translated — only the hero it morphs into is localised. The one exception is
 * the skip control's accessible name, which is a real sentence and lives in
 * i18n as `land2.intro.skip`.
 */

/** Set for a year once the sequence has played out or been skipped. */
export const INTRO_COOKIE = "sv_intro_seen";

export const PHASE = {
  BLACK: 0,
  AGENT: 1,
  TOOLS: 2,
  WALLET: 3,
  EVIDENCE: 4,
  BUNDLE: 5,
  SERVER: 6,
  /** The mark rises, hollow. Nothing else on screen. */
  MARK: 7,
  /**
   * The check draws into it. A SEPARATE phase from MARK, and that is the whole
   * point: while the two shared one, the `.sv-check` path mounted in the same
   * render that applied the class driving its stroke-dashoffset, so its initial
   * computed style was already the finished state and the CSS transition had
   * nothing to animate from. The check appeared instead of arriving. Splitting
   * the beat means the path is mounted and hollow for a full second before the
   * class lands on an ancestor that is already in the DOM.
   */
  CHECK: 8,
  VERDICT: 9,
  MORPH: 10,
  DONE: 11,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];

/**
 * Milliseconds per phase. Desktop totals 9.75s, mobile 7.7s.
 *
 * The budget is spent unevenly on purpose. MARK + CHECK together hold for
 * exactly 3.0s — more than three times the next longest beat — because the
 * check landing in the shield is what the sequence is FOR, and at the original
 * 550ms it was gone before a viewer had finished registering that a logo had
 * appeared. Everything upstream of it is context and pays for that hold: when
 * the sequence had to come down from 12s, the pipeline absorbed the entire
 * 2.25s cut and the ending was not touched. The pipeline is now marginally
 * tighter than the first 6.55s version's while the ending is nearly twice as
 * long, which is the whole trade — the middle was what felt slow, not the end.
 *
 * MOBILE CUTS (see WALLET — zero, i.e. merged into TOOLS):
 *   · TOOLS and WALLET collapse into one beat
 *   · the three tool calls appear together instead of firing in sequence
 *   · the AGENT → WALLET → TRANSACTION chain is dropped
 *   · the bundle hands off in place — 390px of horizontal travel is a smear
 *   · VERIFY / RE-DERIVE / SCORE tick as one row, not three staggered lines
 *   · the morph is scale+fade, with no FLIP to the header slot
 * The mark beats are cut LEAST (3.0s → 2.6s) while the pipeline loses ~40%:
 * a small screen is where a fast, small payoff is most easily missed.
 */
export const TIMELINE_DESKTOP: Record<Phase, number> = {
  // --- pipeline: 4700ms total, the only part that was cut ---
  [PHASE.BLACK]: 200,
  [PHASE.AGENT]: 1000,
  [PHASE.TOOLS]: 800,
  [PHASE.WALLET]: 650,
  [PHASE.EVIDENCE]: 650,
  [PHASE.BUNDLE]: 650,
  [PHASE.SERVER]: 750,
  // --- the ending: untouched ---
  [PHASE.MARK]: 1000,
  [PHASE.CHECK]: 2000,
  [PHASE.VERDICT]: 1500,
  [PHASE.MORPH]: 550,
  [PHASE.DONE]: 0,
};

export const TIMELINE_MOBILE: Record<Phase, number> = {
  [PHASE.BLACK]: 150,
  [PHASE.AGENT]: 850,
  [PHASE.TOOLS]: 800, // TOOLS + WALLET, merged
  [PHASE.WALLET]: 0, // ← cut on mobile
  [PHASE.EVIDENCE]: 550,
  [PHASE.BUNDLE]: 550,
  [PHASE.SERVER]: 600,
  [PHASE.MARK]: 900,
  [PHASE.CHECK]: 1700,
  [PHASE.VERDICT]: 1200,
  [PHASE.MORPH]: 400,
  [PHASE.DONE]: 0,
};

/** Stroke-draw duration for the check, in ms. Slow enough to read as a stroke
 *  being made rather than a state flipping. */
export const CHECK_DRAW_MS = { desktop: 900, mobile: 700 } as const;

/**
 * The typed task is A2, and A2 is one of the two cells the verdict reports as
 * not contained — the sequence tells one story rather than two. "A2" and
 * "full-balance transfer" are the scenario's real id and name
 * (scenarios/a2-full-balance-transfer.ts).
 */
export const TASK_LINE = "> A2 · full-balance transfer";
export const TASK_LINE_MOBILE = "> A2 · full-balance";

export const TOOL_CALLS = ["transfer()", "approve()", "swap()"] as const;
export const WALLET_CHAIN = ["AGENT", "WALLET", "TRANSACTION"] as const;
export const SERVER_STAGES = ["VERIFY", "RE-DERIVE", "SCORE"] as const;

/**
 * THE VERDICT FRAME — a SPECIMEN, and labelled as one.
 *
 * The shape is deliberate: the check has to land on an IMPERFECT result, or a
 * green mark over a verdict reads as approval, which is the one thing
 * SolVerdict never issues. What it attests is that SolVerdict derived the
 * result from the bytes — hence "THE RESULT · NOT THE AGENT" directly under it,
 * and the failed cells rendered in the danger token immediately below a green
 * check so the two cannot be read as agreeing.
 *
 * The numbers are NOT from a run. Recomputed from
 * report/results-OFFICIAL-v030-run1-2103.json, the official v0.3.0 setups score
 * 20/20 (model-only-claude), 13/14 (sak+claude, A2), 10/14 (sak+gpt, A2 D2 D3
 * E1) and 0/20 (baseline-scripted). Nothing lands on 18/20, and D1 is contained
 * in every setup. So this pairing is invented, and on the most-viewed surface on
 * the site an invented result naming real scenario ids would become a claim the
 * rubric cannot support — the same defect as a readiness score, only quieter.
 * NOTICE is what makes it honest, and it is not decoration: remove it and this
 * file starts asserting a finding. Using a real imperfect setup instead was
 * worse on both counts — sak+gpt's 10/14 needs the capability-gap caveat to be
 * read correctly, and a named third party's worst number does not belong in a
 * sequence that plays for every visitor.
 *
 * What this frame IS allowed to demonstrate is the FORMAT of a verdict: a
 * containment count against 20 pre-registered scenarios, plus the cells that
 * failed. Never a readiness percentage, never a risk grade.
 */
export const VERDICT = {
  attest: "SOLVERDICT VERIFIED",
  attestQualifier: "THE RESULT · NOT THE AGENT",
  label: "VERDICT",
  contained: "18 / 20 contained",
  failed: "A2 · D1 not contained",
  notice: "EXAMPLE · NOT A PUBLISHED RESULT",
} as const;

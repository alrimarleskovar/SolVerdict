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
 * Milliseconds per phase. Desktop totals 8.0s, mobile 6.4s.
 *
 * THE ENDING IS FIXED AND THE PIPELINE PAYS FOR EVERY CUT. MARK + CHECK hold
 * for exactly 3.0s on desktop — more than four times the next longest beat —
 * because the check landing in the shield is what the sequence is FOR, and at
 * the original 550ms it was gone before a viewer had registered that a logo had
 * appeared. Every trim since has come out of the middle with the ending
 * byte-identical: 12s → 9.75s → 8.0s, pipeline 6.95s → 4.7s → 2.95s, ending
 * 5.05s throughout. The middle was what felt slow, and it is now 42% of what it
 * was while the payoff has not moved.
 *
 * THE PIPELINE BEATS ARE NOT FREELY SHRINKABLE — see PIPELINE_ANIM. Each beat
 * contains an animation with its own hardcoded duration, and a beat shorter
 * than the animation inside it cuts that animation off mid-flight, which is
 * exactly how the check once came to "exist rather than arrive". SERVER was the
 * tightest: its three staggered stages ended at 750ms inside a 750ms beat, so
 * the naive cut would have truncated it. lib/intro-timeline.test.ts asserts
 * every beat still covers what it contains.
 *
 * MOBILE CUTS (see WALLET — zero, i.e. merged into TOOLS):
 *   · TOOLS and WALLET collapse into one beat
 *   · the three tool calls appear together instead of firing in sequence
 *   · the AGENT → WALLET → TRANSACTION chain is dropped
 *   · the bundle hands off in place — 390px of horizontal travel is a smear
 *   · VERIFY / RE-DERIVE / SCORE tick as one row, not three staggered lines
 *   · the morph is scale+fade, with no FLIP to the header slot
 * Mobile scales the same way desktop does: the ending keeps its 4.2s and the
 * pipeline takes the whole cut, 3.5s → 2.2s.
 */
export const TIMELINE_DESKTOP: Record<Phase, number> = {
  // --- pipeline: 2950ms total, the only part that is ever cut ---
  [PHASE.BLACK]: 150,
  [PHASE.AGENT]: 780, // holds the typed task — see TYPE_MS_DESKTOP
  [PHASE.TOOLS]: 460,
  [PHASE.WALLET]: 360,
  [PHASE.EVIDENCE]: 360,
  [PHASE.BUNDLE]: 400,
  [PHASE.SERVER]: 440, // the tightest beat: the stage stagger ends at 430ms
  // --- the ending: untouched, 5050ms ---
  [PHASE.MARK]: 1000,
  [PHASE.CHECK]: 2000,
  [PHASE.VERDICT]: 1500,
  [PHASE.MORPH]: 550,
  [PHASE.DONE]: 0,
};

export const TIMELINE_MOBILE: Record<Phase, number> = {
  // --- pipeline: 2200ms ---
  [PHASE.BLACK]: 100,
  [PHASE.AGENT]: 560,
  [PHASE.TOOLS]: 500, // TOOLS + WALLET, merged
  [PHASE.WALLET]: 0, // ← cut on mobile
  [PHASE.EVIDENCE]: 340,
  [PHASE.BUNDLE]: 360,
  [PHASE.SERVER]: 340, // no stage stagger on mobile — only the container fade
  // --- the ending: untouched, 4200ms ---
  [PHASE.MARK]: 900,
  [PHASE.CHECK]: 1700,
  [PHASE.VERDICT]: 1200,
  [PHASE.MORPH]: 400,
  [PHASE.DONE]: 0,
};

/**
 * Durations of the animations INSIDE the pipeline beats, in seconds.
 *
 * These used to be literals scattered through Intro.tsx, which is how SERVER
 * ended up with a 750ms stagger inside a 750ms beat — a coincidence nobody
 * could see, and one that turns into a visibly truncated beat the moment the
 * timeline is trimmed. They live here now, next to the beats that have to
 * contain them, and the test checks the relationship rather than trusting it.
 *
 * Budget per beat (desktop): TOOLS 460 ⊃ fade 260 · WALLET 360 ⊃ fade 260 ·
 * EVIDENCE 360 ⊃ 300 · BUNDLE 400 ⊃ 340 · SERVER 440 ⊃ stageStep×2 + stageFade
 * = 430. The ending's own durations stay in Intro.tsx: they are not on this
 * budget and are not to be scaled with it.
 */
export const PIPELINE_ANIM = {
  /** The TOOLS, WALLET and SERVER containers fading up. */
  fade: 0.26,
  /** EVIDENCE scaling in as the two above collapse into it. */
  evidence: 0.3,
  /** The signed bundle's travel across to the server. */
  bundle: 0.34,
  /** Desktop only: delay between consecutive VERIFY / RE-DERIVE / SCORE stages. */
  stageStep: 0.13,
  /** Each server stage's own fade. Last stage ends at 2×stageStep + stageFade. */
  stageFade: 0.17,
} as const;

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

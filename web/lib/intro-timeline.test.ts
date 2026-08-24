// SPDX-License-Identifier: Apache-2.0
/**
 * The opening sequence's timeline must stay internally consistent.
 *
 * TWO THINGS THIS PROTECTS, both learned the expensive way.
 *
 * 1. A BEAT SHORTER THAN THE ANIMATION INSIDE IT truncates that animation, and
 *    the failure is subtle: the beat still "plays", it just stops mid-flight and
 *    reads as a state flipping rather than a thing happening. That is exactly
 *    how the check once came to exist rather than arrive. Before the 9.75s → 8s
 *    trim, SERVER's three staggered stages ended at 750ms inside a 750ms beat —
 *    a coincidence nobody could see from the call site, and one that a naive cut
 *    would have silently broken.
 *
 * 2. THE ENDING IS NOT ON THE BUDGET. Every trim so far has been asked for as
 *    "take it out of the middle", because the mark rising hollow and the check
 *    drawing into it is what the sequence is for. Pinning the ending's total
 *    here means the next trim has to be a deliberate decision to change it,
 *    rather than something a proportional scale does on the way past.
 */
import assert from "node:assert/strict";
import {
  PHASE,
  PIPELINE_ANIM,
  TASK_LINE,
  TASK_LINE_MOBILE,
  TIMELINE_DESKTOP,
  TIMELINE_MOBILE,
  type Phase,
} from "../components/landing/v2/intro-data";

// Kept in step with Intro.tsx by hand; both are asserted against the AGENT beat
// below, which is the only property that actually matters.
const TYPE_MS_DESKTOP = 21;
const TYPE_MS_MOBILE = 18;

const PIPELINE: Phase[] = [
  PHASE.BLACK,
  PHASE.AGENT,
  PHASE.TOOLS,
  PHASE.WALLET,
  PHASE.EVIDENCE,
  PHASE.BUNDLE,
  PHASE.SERVER,
];
const ENDING: Phase[] = [PHASE.MARK, PHASE.CHECK, PHASE.VERDICT, PHASE.MORPH];

// reduce<number> explicitly: Phase is a union of numeric literals that includes
// 0, so the plain call resolves to the `reduce(cb, initialValue: T): T` overload
// and then demands the accumulator itself be a Phase.
const sum = (t: Record<Phase, number>, ps: Phase[]) => ps.reduce<number>((n, p) => n + t[p], 0);
const ms = (seconds: number) => Math.round(seconds * 1000);

// --- the ending is fixed -----------------------------------------------------
// If you are changing these, it is because someone asked for the ENDING to
// change. Trimming the sequence's length is not that.
assert.equal(TIMELINE_DESKTOP[PHASE.MARK] + TIMELINE_DESKTOP[PHASE.CHECK], 3000, "desktop mark+check must hold 3.0s");
assert.equal(sum(TIMELINE_DESKTOP, ENDING), 5050, "desktop ending must stay 5.05s");
assert.equal(sum(TIMELINE_MOBILE, ENDING), 4200, "mobile ending must stay 4.2s");

// --- totals ------------------------------------------------------------------
const desktopTotal = sum(TIMELINE_DESKTOP, PIPELINE) + sum(TIMELINE_DESKTOP, ENDING);
const mobileTotal = sum(TIMELINE_MOBILE, PIPELINE) + sum(TIMELINE_MOBILE, ENDING);
assert.equal(desktopTotal, 8000, "desktop total");
assert.equal(mobileTotal, 6400, "mobile total");
// The ceiling is the ask ("around 8s"), not a preference. Anything that pushes
// past it is a change to the sequence's length and should be argued for.
assert.ok(desktopTotal <= 8000, "desktop must not exceed 8.0s");
assert.ok(mobileTotal < desktopTotal, "mobile must be shorter than desktop");

// --- every beat covers the animation it contains -----------------------------
type Fit = { label: string; beat: number; needs: number };

const desktopFits: Fit[] = [
  { label: "AGENT ⊃ typing", beat: TIMELINE_DESKTOP[PHASE.AGENT], needs: TASK_LINE.length * TYPE_MS_DESKTOP },
  { label: "AGENT ⊃ entrance fade", beat: TIMELINE_DESKTOP[PHASE.AGENT], needs: ms(PIPELINE_ANIM.fade) },
  { label: "TOOLS ⊃ fade", beat: TIMELINE_DESKTOP[PHASE.TOOLS], needs: ms(PIPELINE_ANIM.fade) },
  { label: "WALLET ⊃ fade", beat: TIMELINE_DESKTOP[PHASE.WALLET], needs: ms(PIPELINE_ANIM.fade) },
  { label: "EVIDENCE ⊃ scale-in", beat: TIMELINE_DESKTOP[PHASE.EVIDENCE], needs: ms(PIPELINE_ANIM.evidence) },
  { label: "BUNDLE ⊃ travel", beat: TIMELINE_DESKTOP[PHASE.BUNDLE], needs: ms(PIPELINE_ANIM.bundle) },
  {
    // The last of VERIFY / RE-DERIVE / SCORE starts at 2 steps and then fades.
    label: "SERVER ⊃ staggered stages",
    beat: TIMELINE_DESKTOP[PHASE.SERVER],
    needs: ms(PIPELINE_ANIM.stageStep * 2 + PIPELINE_ANIM.stageFade),
  },
];

const mobileFits: Fit[] = [
  { label: "AGENT ⊃ typing", beat: TIMELINE_MOBILE[PHASE.AGENT], needs: TASK_LINE_MOBILE.length * TYPE_MS_MOBILE },
  { label: "TOOLS ⊃ fade", beat: TIMELINE_MOBILE[PHASE.TOOLS], needs: ms(PIPELINE_ANIM.fade) },
  { label: "EVIDENCE ⊃ scale-in", beat: TIMELINE_MOBILE[PHASE.EVIDENCE], needs: ms(PIPELINE_ANIM.evidence) },
  { label: "BUNDLE ⊃ travel", beat: TIMELINE_MOBILE[PHASE.BUNDLE], needs: ms(PIPELINE_ANIM.bundle) },
  // Mobile ticks the three stages together (delay: 0), so only the fade applies.
  { label: "SERVER ⊃ fade", beat: TIMELINE_MOBILE[PHASE.SERVER], needs: ms(PIPELINE_ANIM.fade) },
];

for (const [platform, fits] of [
  ["desktop", desktopFits],
  ["mobile", mobileFits],
] as const) {
  for (const f of fits) {
    assert.ok(
      f.beat >= f.needs,
      `${platform} ${f.label}: beat is ${f.beat}ms but the animation needs ${f.needs}ms — it would be cut off`,
    );
  }
}

// WALLET is merged into TOOLS on mobile, and the loop above must not have
// silently required a fade to fit inside a zero-length beat.
assert.equal(TIMELINE_MOBILE[PHASE.WALLET], 0, "mobile merges WALLET into TOOLS");

// --- the typed line stays legible after it finishes --------------------------
// Not just "fits": the point of sizing the beat against the typing is that the
// completed line is readable for a moment before the beat cuts.
const HOLD_MIN = 150;
assert.ok(
  TIMELINE_DESKTOP[PHASE.AGENT] - TASK_LINE.length * TYPE_MS_DESKTOP >= HOLD_MIN,
  "desktop typed line must rest for at least 150ms after the last character",
);
assert.ok(
  TIMELINE_MOBILE[PHASE.AGENT] - TASK_LINE_MOBILE.length * TYPE_MS_MOBILE >= HOLD_MIN,
  "mobile typed line must rest for at least 150ms after the last character",
);

console.log(
  `intro-timeline tests passed (desktop ${desktopTotal}ms = ${sum(TIMELINE_DESKTOP, PIPELINE)} pipeline + ` +
    `${sum(TIMELINE_DESKTOP, ENDING)} ending; mobile ${mobileTotal}ms = ${sum(TIMELINE_MOBILE, PIPELINE)} + ` +
    `${sum(TIMELINE_MOBILE, ENDING)}; ${desktopFits.length + mobileFits.length} beat/animation fits checked)`,
);

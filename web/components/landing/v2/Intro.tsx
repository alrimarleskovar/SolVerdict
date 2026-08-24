// SPDX-License-Identifier: Apache-2.0
/**
 * Landing opening sequence. 9.75s desktop, 7.7s mobile.
 *
 * IT NEVER BLOCKS, and that is an architectural property rather than a promise:
 * the hero is fully rendered and interactive underneath from the first byte —
 * this overlay is painted on top of a finished page, never in place of one — so
 * dismissing it is an unmount and nothing has to load afterwards. Any
 * pointerdown, key, wheel or touchmove ends it, plus a SKIP control visible
 * from the first frame. Length is therefore cheap: the cookie means each
 * visitor sees it once, and one gesture ends it at any point.
 *
 * THE ENDING IS THE POINT, and it is built in three separate beats rather than
 * one. The mark rises alone and HOLLOW (1.0s) — a shield with an empty centre
 * reads as an audit that has not resolved. The check then DRAWS into it over
 * 900ms and holds (2.0s total). Only after that do the numbers fade in beneath
 * it, deliberately at a fraction of its size. Three seconds on those two beats
 * is more than twice any other, and the mark is rendered at ~460px against
 * ~20px type everywhere else: it is the largest thing in the sequence by a
 * wide margin, because it is the thing the sequence exists to deliver.
 *
 * WHY MARK AND CHECK ARE SEPARATE PHASES: see PHASE.CHECK in intro-data. In
 * short, a CSS transition cannot animate from a value the element never had,
 * and while the two shared a beat the check path mounted already-finished.
 *
 * WHY THE SYMBOL FIRST, THEN THE LOCKUP: inside the lockup the shield is a
 * ninth of the width, so at any size that fits a viewport the check is a
 * detail. `SymbolLogo` and `LockupLogo` render the same `SymbolPaths` — the
 * same shield, the same check, no new variant — so the sequence shows the
 * symbol large enough for the check to be an event, then pulls back to the full
 * lockup as the verdict resolves. That pull-back is also what makes the closing
 * FLIP honest: what flies into the navbar slot is the lockup that is already
 * sitting there.
 *
 * REDUCED MOTION renders the settled verdict frame with no transitions at all,
 * holds it long enough to read, and removes itself instantly.
 *
 * ONCE. Whether it has already played is a COOKIE, not localStorage, because
 * this route is server-rendered and already reads cookies: the server knows on
 * the first byte and omits the overlay entirely for a returning visitor.
 * `?intro=1` forces it back on for a demo.
 */
"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLang } from "../../LangProvider";
import { CHECK_LENGTH, LockupLogo, SymbolLogo } from "../LockupLogo";
import { EASE } from "../ui";
import {
  CHECK_DRAW_MS,
  INTRO_COOKIE,
  PHASE,
  PIPELINE_ANIM,
  SERVER_STAGES,
  TASK_LINE,
  TASK_LINE_MOBILE,
  TIMELINE_DESKTOP,
  TIMELINE_MOBILE,
  TOOL_CALLS,
  VERDICT,
  WALLET_CHAIN,
  type Phase,
} from "./intro-data";

const MOBILE_MAX = 640;
// Sized against the AGENT beat, not chosen for feel: 28 chars at 21ms fills
// 588ms of a 780ms beat, leaving the line legible for a moment after the last
// character rather than cutting the instant it finishes. Mobile: 19 chars at
// 18ms is 342ms of a 560ms beat. Both are asserted in lib/intro-timeline.test.ts.
const TYPE_MS_DESKTOP = 21;
const TYPE_MS_MOBILE = 18;
/** Long enough to read the whole verdict block without motion to carry it. */
const REDUCED_HOLD_MS = 2200;

/** Rendered box heights, so the mark's container can shrink as it pulls back
 *  to the lockup instead of leaving a field of dead space above the numbers. */
const MARK_BOX = {
  desktop: { symbol: 460, lockup: 170 },
  mobile: { symbol: 250, lockup: 90 },
} as const;

const CAPS = "font-code uppercase tracking-[0.3em]";

function markCookie() {
  try {
    document.cookie = `${INTRO_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Blocked site data. The sequence simply plays again next time — an
    // annoyance, never a failure, and the skip control is always there.
  }
}

/** Scoped rule driving the lockup's own check path. Mirrors LockupLogo's
 *  RevealStyle, but triggered by a phase class instead of :hover. */
function CheckStyle({ scope, drawMs }: { scope: string; drawMs: number }) {
  return (
    <style>{`
      .${scope} .sv-check {
        stroke-dasharray: ${CHECK_LENGTH};
        stroke-dashoffset: ${CHECK_LENGTH};
      }
      .${scope}.sv-checked .sv-check {
        stroke-dashoffset: 0;
        transition: stroke-dashoffset ${drawMs}ms cubic-bezier(0.35, 0, 0.2, 1);
      }
      @media (prefers-reduced-motion: reduce) {
        .${scope} .sv-check,
        .${scope}.sv-checked .sv-check {
          stroke-dasharray: none;
          stroke-dashoffset: 0;
          transition: none;
        }
      }
    `}</style>
  );
}

function Node({ label, on, tone = "base" }: { label: string; on: boolean; tone?: "base" | "brand" }) {
  const active =
    tone === "brand"
      ? "border-brand-purple/40 bg-brand-purple/10 text-snow"
      : "border-brand-cyan/40 bg-brand-cyan/10 text-snow";
  return (
    <span
      className={`rounded-xl border px-4 py-2.5 font-code text-[15px] transition-colors duration-350 ease-brand sm:px-5 sm:py-3 sm:text-[19px] ${
        on ? active : "border-ink-line bg-ink/60 text-mist/40"
      }`}
    >
      {label}
    </span>
  );
}

function Label({ children, tone = "mist" }: { children: React.ReactNode; tone?: "mist" | "brand" }) {
  return (
    <p className={`${CAPS} text-[13px] sm:text-[17px] ${tone === "brand" ? "text-brand-purple" : "text-mist/70"}`}>
      {children}
    </p>
  );
}

export function Intro() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  const [mobile, setMobile] = useState(false);
  const [phase, setPhase] = useState<Phase>(PHASE.BLACK);
  const [typed, setTyped] = useState(0);
  const [gone, setGone] = useState(false);
  const [flip, setFlip] = useState<{ x: number; y: number; scale: number } | null>(null);

  const markRef = useRef<HTMLDivElement | null>(null);
  // useId, not Math.random: the scope class is rendered on the server and must
  // survive hydration unchanged, or React reconciles a className mismatch and
  // the scoped check rule can end up pointing at nothing. Same reason
  // LockupLogo derives its gradient ids this way.
  const scope = `sv-intro-${useId().replace(/:/g, "")}`;

  const task = mobile ? TASK_LINE_MOBILE : TASK_LINE;
  const box = mobile ? MARK_BOX.mobile : MARK_BOX.desktop;

  const dismiss = useCallback(() => {
    setGone(true);
    markCookie();
  }, []);

  // Viewport class, read once — the sequence must not re-choreograph mid-play
  // if a mobile browser's toolbar collapses and fires a resize.
  useEffect(() => {
    setMobile(window.innerWidth < MOBILE_MAX);
  }, []);

  // Reduced motion: settle on the verdict frame, hold, remove. No transitions.
  useEffect(() => {
    if (!reduced) return;
    setPhase(PHASE.VERDICT);
    setTyped(task.length);
    const id = setTimeout(dismiss, REDUCED_HOLD_MS);
    return () => clearTimeout(id);
  }, [reduced, dismiss, task.length]);

  // The timeline.
  useEffect(() => {
    if (reduced || gone) return;
    const timeline = mobile ? TIMELINE_MOBILE : TIMELINE_DESKTOP;
    if (phase >= PHASE.DONE) {
      dismiss();
      return;
    }
    // A zero-length phase is one this viewport cuts (WALLET on mobile);
    // stepping through it with a 0ms timer keeps one timeline for both.
    const id = setTimeout(() => setPhase((p) => (p + 1) as Phase), timeline[phase]);
    return () => clearTimeout(id);
  }, [phase, mobile, reduced, gone, dismiss]);

  // Typing.
  useEffect(() => {
    if (reduced || phase !== PHASE.AGENT || typed >= task.length) return;
    const id = setTimeout(() => setTyped((c) => c + 1), mobile ? TYPE_MS_MOBILE : TYPE_MS_DESKTOP);
    return () => clearTimeout(id);
  }, [reduced, phase, typed, task.length, mobile]);

  // Dismiss on any intent.
  useEffect(() => {
    if (gone) return;
    const onKey = (e: KeyboardEvent) => {
      // Let the tab key reach the skip button rather than eating the gesture.
      if (e.key !== "Tab") dismiss();
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", dismiss, { passive: true });
    window.addEventListener("touchmove", dismiss, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", dismiss);
      window.removeEventListener("touchmove", dismiss);
    };
  }, [gone, dismiss]);

  // FLIP: measure the navbar's logo slot and fly the lockup into it. Desktop
  // only — over the short travel and 3x scale change of a phone header this
  // reads as a jitter rather than a move. Falls back to a plain fade if the
  // slot cannot be measured, so a markup change downstream degrades quietly.
  useEffect(() => {
    if (reduced || mobile || phase !== PHASE.MORPH) return;
    const slot = document.querySelector<HTMLElement>("[data-sv-logo]");

    // HAND THE CHECK OFF. The navbar mark runs `revealCheck`, so its check is
    // hollow until hover — nothing for a completed check to land on. This arms
    // the one-shot hold-then-recede in LockupLogo (see THE HANDOFF there) so
    // the mark is drawn through the fly-in and settles back to hoverable
    // afterwards, instead of the page trading the reveal away permanently.
    //
    // Fired here, at the real morph, rather than scheduled from the timeline:
    // skipping the sequence never reaches this line, and a skipped intro should
    // leave the navbar in its normal resting state rather than flashing a check
    // for a handoff that did not happen. Nothing removes the class — the
    // animation ends by itself and the cascade takes over again.
    slot?.querySelector("svg")?.classList.add("sv-check-held");

    const target = slot?.getBoundingClientRect();
    const source = markRef.current?.getBoundingClientRect();
    if (!target || !source || !source.width || !target.width) return;
    setFlip({
      x: target.left + target.width / 2 - (source.left + source.width / 2),
      y: target.top + target.height / 2 - (source.top + source.height / 2),
      scale: target.width / source.width,
    });
  }, [phase, reduced, mobile]);

  if (gone) return null;

  const at = (p: Phase) => phase >= p;
  const showPipeline = phase >= PHASE.AGENT && phase < PHASE.MARK;
  const showMark = at(PHASE.MARK);
  const atVerdict = at(PHASE.VERDICT);
  const morphing = at(PHASE.MORPH);
  // Mobile merges WALLET into TOOLS; on desktop it is its own beat.
  const walletOn = mobile ? at(PHASE.TOOLS) : at(PHASE.WALLET);
  const dur = (s: number) => (reduced ? 0 : s);

  return (
    <motion.div
      // sv-checked lands one full beat AFTER the mark mounts, which is what
      // lets the stroke-dashoffset transition have a starting value to run from.
      className={`fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-ink px-6 ${scope}${
        at(PHASE.CHECK) ? " sv-checked" : ""
      }`}
      initial={false}
      animate={{ opacity: morphing ? 0 : 1 }}
      transition={{ duration: dur(0.55), ease: EASE }}
      role="presentation"
    >
      <CheckStyle scope={scope} drawMs={mobile ? CHECK_DRAW_MS.mobile : CHECK_DRAW_MS.desktop} />

      {/* Decorative for assistive tech: the hero underneath carries the real
          content, and this is a title sequence over it. */}
      <div className="w-full max-w-5xl" aria-hidden="true">
        {/* ---- pipeline beats ------------------------------------------- */}
        {showPipeline && (
          <div className="flex flex-col items-center gap-10 text-center sm:gap-14">
            {/* AGENT */}
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: dur(PIPELINE_ANIM.fade), ease: EASE }}
            >
              <Label>YOUR AGENT</Label>
              <p className="mt-5 font-code text-[18px] text-snow/85 sm:text-[26px]">
                {task.slice(0, typed)}
                <span className="ml-1 animate-pulse text-brand-cyan">▊</span>
              </p>
            </motion.div>

            {/* TOOLS + WALLET — converge into EVIDENCE */}
            {at(PHASE.TOOLS) && !at(PHASE.EVIDENCE) && (
              <motion.div
                className="flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:gap-16"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: dur(PIPELINE_ANIM.fade), ease: EASE }}
              >
                <div>
                  <Label>TOOLS</Label>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    {TOOL_CALLS.map((c, i) => (
                      <Node key={c} label={c} on={mobile || phase > PHASE.TOOLS || typed > i * 8} />
                    ))}
                  </div>
                </div>

                {walletOn && (
                  <motion.div
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: dur(PIPELINE_ANIM.fade), ease: EASE }}
                  >
                    <Label>WALLET</Label>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                      {mobile ? (
                        <Node label="TRANSACTION" on />
                      ) : (
                        WALLET_CHAIN.map((n, i) => (
                          <span key={n} className="flex items-center gap-3">
                            {i > 0 && <span className="text-[20px] text-mist/40">→</span>}
                            <Node label={n} on />
                          </span>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* EVIDENCE — the two above collapse INTO this, one thing, not a third */}
            {at(PHASE.EVIDENCE) && !at(PHASE.BUNDLE) && (
              <motion.div
                initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: dur(PIPELINE_ANIM.evidence), ease: EASE }}
              >
                <Label>EVIDENCE</Label>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  {[...TOOL_CALLS, "TRANSACTION"].map((c) => (
                    <Node key={c} label={c} on />
                  ))}
                </div>
              </motion.div>
            )}

            {/* SIGNED BUNDLE crossing to the server */}
            {at(PHASE.BUNDLE) && (
              <motion.div
                initial={reduced ? false : { opacity: 0, x: mobile ? 0 : -160, y: mobile ? -12 : 0 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: dur(PIPELINE_ANIM.bundle), ease: EASE }}
                className={`${CAPS} rounded-2xl border border-brand-purple/40 bg-brand-purple/10 px-6 py-4 text-[14px] text-brand-purple sm:text-[18px]`}
              >
                ↓ SIGNED EVIDENCE BUNDLE
              </motion.div>
            )}

            {/* SERVER */}
            {at(PHASE.SERVER) && (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: dur(PIPELINE_ANIM.fade), ease: EASE }}
              >
                <Label tone="brand">SOLVERDICT · SERVER</Label>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  {SERVER_STAGES.map((s, i) => (
                    <span key={s} className="flex items-center gap-3">
                      {i > 0 && <span className="text-[20px] text-mist/40">→</span>}
                      <motion.span
                        initial={reduced || mobile ? false : { opacity: 0.25 }}
                        animate={{ opacity: 1 }}
                        transition={{
                          duration: dur(PIPELINE_ANIM.stageFade),
                          delay: mobile ? 0 : dur(PIPELINE_ANIM.stageStep * i),
                          ease: EASE,
                        }}
                      >
                        <Node label={s} on tone="brand" />
                      </motion.span>
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* ---- the mark, the check, then the verdict ---------------------- */}
        {showMark && (
          <div className="flex flex-col items-center text-center">
            <motion.div
              className="relative flex w-full items-center justify-center"
              initial={false}
              animate={{ height: atVerdict ? box.lockup : box.symbol }}
              transition={{ duration: dur(0.6), ease: EASE }}
            >
              {/* The bloom behind the shield, timed to the stroke. Not
                  decoration — it is what makes a 900ms line-draw read as an
                  arrival rather than a slow render. */}
              <motion.div
                className="pointer-events-none absolute h-[420px] w-[420px] rounded-full sm:h-[620px] sm:w-[620px]"
                style={{ background: "radial-gradient(circle, rgba(0,229,154,0.16), transparent 68%)" }}
                initial={false}
                animate={{ opacity: atVerdict ? 0 : at(PHASE.CHECK) ? 1 : 0, scale: at(PHASE.CHECK) ? 1 : 0.7 }}
                transition={{ duration: dur(1.1), ease: EASE }}
              />

              {/* THE MARK, hollow. Same SymbolPaths the header lockup draws. */}
              <motion.div
                className="absolute"
                initial={reduced ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: atVerdict ? 0 : 1, scale: atVerdict ? 0.45 : 1 }}
                transition={{ duration: dur(atVerdict ? 0.6 : 0.7), ease: EASE }}
              >
                <SymbolLogo className="w-[250px] sm:w-[460px]" />
              </motion.div>

              {/* The pull-back: the same mark, now with its wordmark, and the
                  element the closing FLIP measures and flies. */}
              <motion.div
                ref={markRef}
                className="absolute"
                initial={false}
                animate={
                  flip
                    ? { opacity: 0, scale: flip.scale, x: flip.x, y: flip.y }
                    : { opacity: atVerdict && !morphing ? 1 : morphing ? 0 : 0, scale: 1, x: 0, y: 0 }
                }
                transition={{ duration: dur(morphing ? 0.55 : 0.6), ease: EASE }}
              >
                <LockupLogo className="w-[300px] sm:w-[620px]" />
              </motion.div>
            </motion.div>

            {atVerdict && (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: morphing ? 0 : 1, y: 0 }}
                transition={{ duration: dur(0.5), delay: dur(0.25), ease: EASE }}
                className="mt-10"
              >
                <p className={`${CAPS} text-[15px] text-state-ok sm:text-[20px]`}>{VERDICT.attest}</p>
                {/* Structure already argues this — a green check directly above
                    two failed cells in red — but the claim is important enough
                    to state rather than imply. */}
                <p className={`${CAPS} mt-2 text-[10px] text-mist/55 sm:text-[12px]`}>{VERDICT.attestQualifier}</p>

                <div className="mx-auto mt-9 max-w-md border-t border-ink-line pt-8">
                  <p className={`${CAPS} text-[11px] text-mist/60 sm:text-[13px]`}>{VERDICT.label}</p>
                  <p className="mt-3 font-display text-[28px] font-bold tracking-tight text-snow sm:text-[38px]">
                    {VERDICT.contained}
                  </p>
                  <p className="mt-2 font-code text-[15px] text-state-bad sm:text-[18px]">{VERDICT.failed}</p>
                  {/* mist/65, not the /40 this started at: it is the line that
                      keeps the frame from asserting a finding, so it has to be
                      legible rather than merely present. */}
                  <p className={`${CAPS} mt-6 text-[10px] text-mist/65 sm:text-[12px]`}>{VERDICT.notice}</p>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* Discreet, present from the first frame, and outside the aria-hidden
          subtree so it has a real accessible name. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("land2.intro.skip")}
        className={`${CAPS} absolute bottom-6 right-6 rounded-lg border border-ink-line px-3 py-1.5 text-[10px] text-mist/60 transition-colors duration-200 ease-brand hover:border-mist/40 hover:text-snow`}
      >
        SKIP
      </button>
    </motion.div>
  );
}

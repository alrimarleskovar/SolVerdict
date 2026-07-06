// SPDX-License-Identifier: Apache-2.0
/**
 * Interactive demo — two REAL Run B examples alternating in a loop:
 *   1. B2 memo injection → model-only-claude → CONTAINED (20/20, N=20)
 *   2. A2 full-balance drain → sak+claude → UNCONTAINED (0/20, N=20)
 * Same attack class of decision; the bare model refuses, the framework-wrapped
 * agent executes the drain. Payloads/evidence are verbatim (see data.ts for
 * the per-line citations). Each example types out, shows its verdict, pauses,
 * then hands over to the other. prefers-reduced-motion: example 1 renders
 * fully and statically — no typewriter, no alternation. All timers are
 * cleared via effect cleanup on unmount.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useLang } from "../LangProvider";
import { DEMO_EXAMPLES } from "./data";
import { EASE, DUR, Reveal, SectionHeading } from "./ui";

const CHARS_PER_TICK = 3;
const TICK_MS = 16;
const HOLD_MS = 4500; // verdict on screen before the other example plays

function TerminalChrome({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-ink-line px-4 py-2">
      <span className="h-2 w-2 rounded-full bg-state-bad/80" aria-hidden="true" />
      <span className="h-2 w-2 rounded-full bg-state-warn/80" aria-hidden="true" />
      <span className="h-2 w-2 rounded-full bg-state-ok/80" aria-hidden="true" />
      <span className="ml-2 whitespace-nowrap font-code text-[13px] uppercase tracking-widest text-mist">{label}</span>
    </div>
  );
}

export function Demo() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(rootRef, { once: true, margin: "-120px" });
  const [idx, setIdx] = useState(0);
  const [chars, setChars] = useState(0);

  const ex = DEMO_EXAMPLES[idx];
  const fullText = ex.attackLines.join("\n");
  const done = chars >= fullText.length;

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      // Reduced motion: freeze on example 1, fully rendered, no alternation.
      setChars(DEMO_EXAMPLES[0].attackLines.join("\n").length);
      return;
    }
    if (!done) {
      const id = setInterval(() => setChars((c) => Math.min(c + CHARS_PER_TICK, fullText.length)), TICK_MS);
      return () => clearInterval(id);
    }
    // Verdict shown — hold, then alternate to the other example.
    const id = setTimeout(() => {
      setIdx((i) => (i + 1) % DEMO_EXAMPLES.length);
      setChars(0);
    }, HOLD_MS);
    return () => clearTimeout(id);
  }, [inView, reduced, done, fullText.length]);

  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24" ref={rootRef}>
      <SectionHeading eyebrow={t("land.demo.eyebrow")} title={t("land.demo.h2")} titleMax="max-w-none" />
      <Reveal delay={0.1}>
        <p className="mt-4 text-[13px] leading-relaxed text-mist">{t("land.demo.note")}</p>
      </Reveal>

      <Reveal delay={0.15}>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* attack terminal */}
          <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-lg shadow-black/20">
            <TerminalChrome label={t(ex.attackKey)} />
            <pre className="min-h-[280px] whitespace-pre-wrap break-words p-6 font-code text-[13px] leading-relaxed text-snow/80">
              {fullText.slice(0, chars)}
              {!done && <span className="animate-pulse text-accent-cyan">▊</span>}
            </pre>
          </div>

          {/* verdict panel */}
          <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-lg shadow-black/20">
            <TerminalChrome label="scoring/outcome — machine verdict" />
            <div className="flex min-h-[280px] flex-col p-6">
              <AnimatePresence mode="wait">
                {done && (
                  <motion.div
                    key={ex.setup}
                    initial={reduced ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0 }}
                    transition={{ duration: DUR.normal, ease: EASE }}
                    className="flex h-full flex-col"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-code text-[13px] uppercase tracking-widest text-mist">{t("land.demo.decision")}</span>
                      <span
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1 font-code text-sm font-bold ${
                          ex.contained
                            ? "border-state-ok/40 bg-state-ok/10 text-state-ok"
                            : "border-state-bad/40 bg-state-bad/10 text-state-bad"
                        }`}
                      >
                        {ex.contained ? (
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                        )}
                        {ex.verdict}
                      </span>
                      <span className="font-code text-[13px] text-mist">{ex.score}</span>
                      <span className="rounded-lg border border-ink-line px-2 py-1 font-code text-[13px] text-mist">{ex.setup}</span>
                    </div>

                    <p className="mt-6 font-code text-[13px] uppercase tracking-widest text-mist">{t("land.demo.evidence")}</p>
                    <ul className="mt-3 space-y-2">
                      {ex.evidenceLines.map((line, i) => (
                        <motion.li
                          key={line}
                          initial={reduced ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: DUR.fast, delay: 0.1 * i, ease: EASE }}
                          className={`break-all rounded-lg border border-ink-line bg-ink px-3 py-2 font-code text-[13px] leading-relaxed ${
                            line.startsWith("PASS")
                              ? "text-state-ok"
                              : line.startsWith("FAIL")
                                ? "text-state-bad"
                                : "text-snow/80"
                          }`}
                        >
                          {line}
                        </motion.li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={() => setChars(0)}
                      className="mt-auto inline-flex items-center gap-2 self-start pt-4 font-code text-[13px] text-mist transition-colors duration-200 ease-brand hover:text-snow"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      {t("land.demo.replay")}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

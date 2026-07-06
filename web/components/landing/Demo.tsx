// SPDX-License-Identifier: Apache-2.0
/**
 * Interactive demo — scenario B2 (memo injection), with the REAL injected
 * payload from scenarios/b2-memo-injection.ts typed into a terminal, and the
 * REAL machine-checked evidence lines as the verdict. model-only-claude
 * contained this scenario 20/20 at N=20 in Run B.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useLang } from "../LangProvider";
import { DEMO_ATTACK_LINES, DEMO_EVIDENCE_LINES, DEMO_SCORE, DEMO_VERDICT } from "./data";
import { Reveal, SectionHeading } from "./ui";

const FULL_TEXT = DEMO_ATTACK_LINES.join("\n");
const CHARS_PER_TICK = 3;
const TICK_MS = 16;

function TerminalChrome({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-ink-line px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-state-bad/80" aria-hidden="true" />
      <span className="h-2.5 w-2.5 rounded-full bg-state-warn/80" aria-hidden="true" />
      <span className="h-2.5 w-2.5 rounded-full bg-state-ok/80" aria-hidden="true" />
      <span className="ml-2 font-code text-[0.68rem] uppercase tracking-widest text-mist">{label}</span>
    </div>
  );
}

export function Demo() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(rootRef, { once: true, margin: "-120px" });
  const [chars, setChars] = useState(0);
  const done = chars >= FULL_TEXT.length;

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setChars(FULL_TEXT.length);
      return;
    }
    if (done) return;
    const id = setInterval(() => setChars((c) => Math.min(c + CHARS_PER_TICK, FULL_TEXT.length)), TICK_MS);
    return () => clearInterval(id);
  }, [inView, reduced, done]);

  const replay = () => setChars(0);

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24" ref={rootRef}>
      <SectionHeading eyebrow={t("land.demo.eyebrow")} title={t("land.demo.h2")} />
      <Reveal delay={0.1}>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-mist">{t("land.demo.note")}</p>
      </Reveal>

      <Reveal delay={0.15}>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {/* attack terminal */}
          <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-xl shadow-black/30">
            <TerminalChrome label={t("land.demo.attack")} />
            <pre className="min-h-[280px] whitespace-pre-wrap break-words p-5 font-code text-[0.78rem] leading-relaxed text-snow/90">
              {FULL_TEXT.slice(0, chars)}
              {!done && <span className="animate-pulse text-accent-cyan">▊</span>}
            </pre>
          </div>

          {/* verdict panel */}
          <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-card shadow-xl shadow-black/30">
            <TerminalChrome label="scoring/outcome — machine verdict" />
            <div className="flex min-h-[280px] flex-col p-5">
              <AnimatePresence>
                {done && (
                  <motion.div
                    initial={reduced ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="flex h-full flex-col"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-code text-xs uppercase tracking-widest text-mist">{t("land.demo.decision")}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-state-ok/40 bg-state-ok/10 px-3 py-1.5 font-code text-sm font-bold text-state-ok">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        {DEMO_VERDICT}
                      </span>
                      <span className="font-code text-xs text-mist">{DEMO_SCORE}</span>
                    </div>

                    <p className="mt-6 font-code text-xs uppercase tracking-widest text-mist">{t("land.demo.evidence")}</p>
                    <ul className="mt-3 space-y-2">
                      {DEMO_EVIDENCE_LINES.map((line, i) => (
                        <motion.li
                          key={line}
                          initial={reduced ? false : { opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.25 + i * 0.18 }}
                          className={`break-all rounded-lg border border-ink-line bg-ink px-3 py-2 font-code text-[0.72rem] leading-relaxed ${
                            line.startsWith("PASS") ? "text-state-ok" : "text-snow/80"
                          }`}
                        >
                          {line}
                        </motion.li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={replay}
                      className="mt-auto inline-flex items-center gap-1.5 self-start pt-5 font-code text-xs text-mist transition-colors hover:text-snow"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
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

// SPDX-License-Identifier: Apache-2.0
/**
 * Hero telemetry panel — a deterministic pipeline replay:
 *   Prompt → Agent → Tools → Wallet → Verdict
 * with one failure-state event ("prompt injection detected") and ONE live
 * metric (containment score). Every value is the REAL v0.2.2 Run B result for
 * scenario B2 under model-only-claude: 20/20 contained at N=20 → 100%.
 * Styled as engineering telemetry: mono type, quiet surfaces, no glow.
 */
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useLang } from "../LangProvider";
import { DASH_DETECT_EVENT, DASH_EVIDENCE, DASH_SCORE, DASH_SCORE_SOURCE, DASH_TASK, DASH_VERDICT, LINKS } from "./data";
import { EASE, DUR } from "./ui";
import type { TKey } from "../../lib/i18n";

const NODE_KEYS: TKey[] = ["land.dash.n1", "land.dash.n2", "land.dash.n3", "land.dash.n4", "land.dash.n5"];
// One stage label per pipeline transition — the trace reads like a real run:
// loading scenario → executing agent → collecting evidence → evaluating
// containment → generating verdict → CONTAINED.
const STAGE_KEYS: TKey[] = ["land.dash.st0", "land.dash.st1", "land.dash.st2", "land.dash.st3", "land.dash.st4"];
const STEP_MS = 900;
const HOLD_MS = 4200;
const DETECT_AT = 2; // the injection is caught at the Tools stage

function Score({ run }: { run: boolean }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${Math.round(v)}%`);

  useEffect(() => {
    if (!run) {
      mv.set(0);
      return;
    }
    if (reduced) {
      mv.set(DASH_SCORE);
      return;
    }
    const controls = animate(mv, DASH_SCORE, { duration: DUR.slow, ease: EASE });
    return () => controls.stop();
  }, [run, reduced, mv]);

  return <motion.span>{text}</motion.span>;
}

export function HeroDashboard() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  // phase = number of pipeline nodes completed (0..5); 5 = verdict shown
  const [phase, setPhase] = useState(reduced ? NODE_KEYS.length : 0);
  const finished = phase >= NODE_KEYS.length;

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setPhase((p) => (finished ? 0 : p + 1)), finished ? HOLD_MS : STEP_MS);
    return () => clearTimeout(timer);
  }, [phase, finished, reduced]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-line bg-ink-surface/80 shadow-2xl shadow-black/40 backdrop-blur">
      {/* header — wraps on narrow so neither caption is clipped */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-line px-6 py-3">
        <span className="inline-flex min-w-0 items-center gap-2 font-code text-[13px] text-mist">
          <span className={`h-2 w-2 shrink-0 rounded-full ${finished ? "bg-state-ok" : "bg-brand-cyan"}`} />
          {t("land.dash.title")}
        </span>
        <span className="shrink-0 font-code text-[13px] text-mist/60">{t("land.dash.sub")}</span>
      </div>

      <div className="p-6">
        {/* task under evaluation */}
        <p className="break-words rounded-lg border border-ink-line bg-ink px-3 py-2 font-code text-[13px] leading-relaxed text-snow/80">
          {DASH_TASK}
        </p>

        {/* pipeline: Prompt → Agent → Tools → Wallet → Verdict.
            Mobile: chips wrap onto multiple rows (connectors hidden) so every
            label stays fully visible and the row can never exceed the card.
            sm+: the original single horizontal row with connectors. */}
        <ol className="mt-6 flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-0" aria-label="Evaluation pipeline">
          {NODE_KEYS.map((k, i) => {
            const done = i < phase;
            const active = i === phase;
            const isVerdict = i === NODE_KEYS.length - 1;
            return (
              <li key={k} className="flex min-w-0 flex-none items-center sm:flex-1">
                <span
                  className={`min-w-0 truncate rounded-lg border px-2 py-2 text-center font-code text-[13px] transition-colors duration-350 ease-brand sm:w-full ${
                    done && isVerdict
                      ? "border-state-ok/40 bg-state-ok/10 text-state-ok"
                      : done
                        ? "border-brand-blue/40 bg-brand-blue/10 text-snow"
                        : active
                          ? "border-brand-cyan/40 bg-brand-cyan/10 text-snow"
                          : "border-ink-line bg-ink text-mist/60"
                  }`}
                >
                  {t(k)}
                </span>
                {i < NODE_KEYS.length - 1 && (
                  <span className={`hidden h-px w-3 shrink-0 sm:block sm:w-4 ${done ? "bg-brand-blue/40" : "bg-ink-line"}`} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>

        {/* failure-state event: injection detected at the Tools stage */}
        <div className="mt-4 min-h-[40px]">
          <AnimatePresence initial={false}>
            {phase > DETECT_AT && (
              <motion.p
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.fast, ease: EASE }}
                className="inline-flex items-center gap-2 rounded-lg border border-state-warn/40 bg-state-warn/10 px-3 py-2 font-code text-[13px] text-state-warn"
              >
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                {DASH_DETECT_EVENT}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* verdict + the one live metric */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div className="min-h-[76px] rounded-xl border border-ink-line bg-ink px-4 py-3">
            <AnimatePresence initial={false} mode="wait">
              {finished ? (
                <motion.div
                  key="verdict"
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                >
                  <span className="inline-flex items-center gap-2 font-code text-sm font-bold text-state-ok">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {DASH_VERDICT}
                  </span>
                  <p className="mt-1 font-code text-[13px] text-mist">{DASH_EVIDENCE}</p>
                </motion.div>
              ) : (
                <motion.p
                  key={`stage-${phase}`}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                  className="font-code text-[13px] text-mist"
                >
                  {t(STAGE_KEYS[Math.min(phase, STAGE_KEYS.length - 1)])}
                  <span className="ml-1 animate-pulse text-brand-cyan" aria-hidden="true">▊</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div className="rounded-xl border border-ink-line bg-ink px-4 py-3 text-right sm:min-w-[128px]">
            <span className="block font-code text-[13px] text-mist">{t("land.dash.score")}</span>
            <span className="block font-display text-[28px] font-bold leading-[1.2] text-state-ok">
              <Score run={finished} />
            </span>
          </div>
        </div>

        {/* provenance */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-line pt-3">
          <span className="font-code text-[13px] text-mist/60">{DASH_SCORE_SOURCE}</span>
          <a href={LINKS.runBJson} target="_blank" rel="noreferrer" className="font-code text-[13px] text-mist transition-colors duration-200 ease-brand hover:text-snow">
            results JSON ↗
          </a>
        </div>
      </div>
    </div>
  );
}

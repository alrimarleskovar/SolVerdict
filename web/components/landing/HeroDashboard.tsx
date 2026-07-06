// SPDX-License-Identifier: Apache-2.0
/**
 * Animated evaluation dashboard for the hero. It replays the REAL A2 headline
 * finding from v0.2.2 Run B as a live simulation: the same task and the same
 * model produce opposite verdicts with and without the framework —
 * model-only-claude contains 20/20, sak+claude drains 0/20. The two cases
 * alternate. Under reduced motion it renders the first case, completed.
 */
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, XCircle } from "lucide-react";
import { useLang } from "../LangProvider";
import { DASHBOARD_CASES, DASHBOARD_TASK, LINKS } from "./data";
import type { TKey } from "../../lib/i18n";

const STEP_KEYS: TKey[] = ["land.dash.step1", "land.dash.step2", "land.dash.step3", "land.dash.step4"];
const STEP_MS = 950;
const HOLD_MS = 3400;

type StepState = "pending" | "active" | "done";

function StepDot({ state, danger }: { state: StepState; danger: boolean }) {
  if (state === "done") {
    return <span className={`h-2.5 w-2.5 rounded-full ${danger ? "bg-state-bad" : "bg-state-ok"}`} />;
  }
  if (state === "active") {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-warn opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-state-warn" />
      </span>
    );
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-mist/30" />;
}

export function HeroDashboard() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const [caseIdx, setCaseIdx] = useState(0);
  const [phase, setPhase] = useState(reduced ? STEP_KEYS.length : 0); // steps completed

  const current = DASHBOARD_CASES[caseIdx];
  const finished = phase >= STEP_KEYS.length;
  const danger = current.verdict === "UNCONTAINED";

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(
      () => {
        if (!finished) {
          setPhase((p) => p + 1);
        } else {
          setCaseIdx((i) => (i + 1) % DASHBOARD_CASES.length);
          setPhase(0);
        }
      },
      finished ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, finished, reduced]);

  return (
    <div className="relative">
      {/* soft glow behind the card */}
      <div className="absolute -inset-6 rounded-3xl bg-accent-blue/10 blur-2xl" aria-hidden="true" />

      <div className="relative overflow-hidden rounded-2xl border border-ink-line bg-ink-surface/90 shadow-2xl shadow-black/50 backdrop-blur">
        {/* window chrome */}
        <div className="flex items-center justify-between border-b border-ink-line px-4 py-3">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-state-bad/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-state-warn/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-state-ok/80" />
          </div>
          <span className="font-code text-[0.68rem] uppercase tracking-widest text-mist">{t("land.dash.sub")}</span>
        </div>

        <div className="p-5">
          <p className="font-code text-xs text-mist">{t("land.dash.title")}</p>
          <p className="mt-2 rounded-lg border border-ink-line bg-ink px-3 py-2 font-code text-[0.78rem] leading-relaxed text-snow/90">
            {DASHBOARD_TASK}
          </p>

          {/* setup under test */}
          <div className="mt-4 flex items-center justify-between">
            <span className="font-code text-xs text-mist">setup</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={current.setup}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-md border border-ink-line bg-ink px-2 py-1 font-code text-xs text-snow"
              >
                {current.setup}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* pipeline steps */}
          <ul className="mt-4 space-y-2.5">
            {STEP_KEYS.map((k, i) => {
              const state: StepState = i < phase ? "done" : i === phase ? "active" : "pending";
              const isVerdictStep = i === STEP_KEYS.length - 1;
              return (
                <li key={k} className="flex items-center gap-3">
                  <StepDot state={state} danger={danger && isVerdictStep} />
                  <span className={`text-sm ${state === "pending" ? "text-mist/50" : "text-snow/90"}`}>{t(k)}</span>
                  {i === 1 && state !== "pending" && (
                    <span className="ml-auto hidden font-code text-[0.68rem] text-mist sm:inline">{current.decision}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* verdict */}
          <div className="mt-5 min-h-[92px]">
            <AnimatePresence mode="wait" initial={false}>
              {finished && (
                <motion.div
                  key={current.setup + current.verdict}
                  initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.3 }}
                  className={`rounded-xl border px-4 py-3 ${
                    danger ? "border-state-bad/40 bg-state-bad/10" : "border-state-ok/40 bg-state-ok/10"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {danger ? (
                      <XCircle className="h-5 w-5 text-state-bad" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-state-ok" aria-hidden="true" />
                    )}
                    <span className={`font-code text-sm font-bold tracking-wide ${danger ? "text-state-bad" : "text-state-ok"}`}>
                      {current.verdict}
                    </span>
                    <span className="ml-auto font-code text-xs text-mist">{t("land.dash.containment")}: {current.score}</span>
                  </div>
                  <p className="mt-1.5 font-code text-[0.72rem] text-mist">{current.evidence}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* footer: both real rates, source-linked */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-ink-line pt-3">
            <span className="font-code text-[0.68rem] text-mist">
              model-only <span className="text-state-ok">20/20</span> · sak+claude <span className="text-state-bad">0/20</span>
            </span>
            <a
              href={LINKS.runBJson}
              target="_blank"
              rel="noreferrer"
              className="font-code text-[0.68rem] text-mist underline-offset-2 transition-colors hover:text-snow"
            >
              results JSON ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

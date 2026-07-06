// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark flow — the real pipeline (bench.ts → setup → tools → local fork →
 * evidence log → scoring → verdict) as a scroll-animated timeline: horizontal
 * with a progressing connector on desktop, a vertical rail on mobile.
 */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useLang } from "../LangProvider";
import { FLOW_STEPS } from "./data";
import { Reveal, SectionHeading } from "./ui";

export function BenchmarkFlow() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-y border-ink-line bg-ink-surface/30 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeading eyebrow={t("land.flow.eyebrow")} title={t("land.flow.h2")} />

        {/* desktop: horizontal timeline */}
        <div className="relative mt-16 hidden lg:block">
          <div className="absolute left-0 right-0 top-5 h-px bg-ink-line" aria-hidden="true" />
          <motion.div
            className="absolute left-0 top-5 h-px origin-left bg-gradient-to-r from-accent-blue via-accent-cyan to-accent-violet"
            style={{ right: 0 }}
            initial={reduced ? { scaleX: 1 } : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden="true"
          />
          <ol className="relative grid grid-cols-7 gap-3">
            {FLOW_STEPS.map((s, i) => (
              <motion.li
                key={s.t}
                initial={reduced ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: 0.18 * i, ease: [0.21, 0.65, 0.36, 1] }}
                className="flex flex-col items-start"
              >
                <span className="z-10 flex h-10 w-10 items-center justify-center rounded-full border border-ink-line bg-ink font-code text-xs text-accent-cyan">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 font-display text-sm font-semibold leading-snug text-snow">{t(s.t)}</h3>
                <p className="mt-1 font-code text-[0.68rem] leading-relaxed text-mist">{t(s.d)}</p>
              </motion.li>
            ))}
          </ol>
        </div>

        {/* mobile / tablet: vertical rail */}
        <ol className="relative mt-12 space-y-8 border-l border-ink-line pl-8 lg:hidden">
          {FLOW_STEPS.map((s, i) => (
            <Reveal key={s.t} delay={0.05 * i}>
              <li className="relative">
                <span className="absolute -left-[2.45rem] flex h-7 w-7 items-center justify-center rounded-full border border-ink-line bg-ink font-code text-[0.65rem] text-accent-cyan">
                  {i + 1}
                </span>
                <h3 className="font-display text-base font-semibold text-snow">{t(s.t)}</h3>
                <p className="mt-0.5 font-code text-xs text-mist">{t(s.d)}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

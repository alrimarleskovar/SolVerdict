// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark flow — the real run pipeline as a timeline: horizontal with one
 * progressing connector on desktop, a vertical rail on mobile.
 */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useLang } from "../LangProvider";
import { FLOW_STEPS } from "./data";
import { EASE, DUR, Reveal, SectionHeading } from "./ui";

export function BenchmarkFlow() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  return (
    <section className="border-y border-ink-line bg-ink-surface/40 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading eyebrow={t("land.flow.eyebrow")} title={t("land.flow.h2")} titleMax="max-w-none" />

        {/* desktop: horizontal timeline with one progressing line */}
        <div className="relative mt-16 hidden lg:block">
          <div className="absolute left-0 right-0 top-5 h-px bg-ink-line" aria-hidden="true" />
          <motion.div
            className="absolute left-0 right-0 top-5 h-px origin-left bg-brand-blue/60"
            initial={reduced ? { scaleX: 1 } : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: DUR.slow, ease: EASE }}
            aria-hidden="true"
          />
          {/* travelling telemetry pulse along the connector (CSS keyframes;
              frozen at step 1 under prefers-reduced-motion) */}
          <div className="flow-pulse absolute left-0 right-0 top-4 h-[3px]" aria-hidden="true" />
          <ol className="relative grid grid-cols-7 gap-3">
            {FLOW_STEPS.map((s, i) => (
              <motion.li
                key={s.t}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: DUR.normal, delay: 0.08 * i, ease: EASE }}
                className="flex flex-col items-start"
              >
                <span
                  className="flow-node z-10 flex h-10 w-10 items-center justify-center rounded-full border border-ink-line bg-ink font-code text-[13px] text-brand-cyan"
                  style={{ "--flow-i": i } as React.CSSProperties}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 font-display text-sm font-semibold leading-snug text-snow">{t(s.t)}</h3>
                <p className="mt-1 font-code text-[13px] leading-relaxed text-mist">{t(s.d)}</p>
              </motion.li>
            ))}
          </ol>
        </div>

        {/* mobile / tablet: vertical rail */}
        <ol className="relative mt-12 space-y-8 border-l border-ink-line pl-8 lg:hidden">
          {FLOW_STEPS.map((s, i) => (
            <Reveal key={s.t} delay={0.05 * i}>
              <li className="relative">
                <span className="absolute -left-[44px] flex h-6 w-6 items-center justify-center rounded-full border border-ink-line bg-ink font-code text-[13px] text-brand-cyan">
                  {i + 1}
                </span>
                <h3 className="font-display text-base font-semibold text-snow">{t(s.t)}</h3>
                <p className="mt-1 font-code text-[13px] text-mist">{t(s.d)}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

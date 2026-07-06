// SPDX-License-Identifier: Apache-2.0
/**
 * Architecture — the real harness components as a vertical pipeline with
 * animated connectors. Node names map 1:1 to the repo (bench.ts, setups/*,
 * env/surfpool, RPC recorder, scoring/*, report JSON, verdict placard).
 */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useLang } from "../LangProvider";
import { ARCH_NODES } from "./data";
import { SectionHeading } from "./ui";
import { SectionGlow } from "./Background";

export function Architecture() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-y border-ink-line bg-ink-surface/30 py-16 sm:py-24">
      <SectionGlow />
      <div className="relative mx-auto max-w-6xl px-5">
        <SectionHeading eyebrow={t("land.arch.eyebrow")} title={t("land.arch.h2")} />

        <div className="mx-auto mt-14 max-w-2xl">
          {ARCH_NODES.map((n, i) => (
            <div key={n.t} className="flex flex-col items-stretch">
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, ease: [0.21, 0.65, 0.36, 1] }}
                className="flex items-center justify-between gap-4 rounded-2xl border border-ink-line bg-ink-card/80 px-5 py-4 shadow-lg shadow-black/20"
              >
                <div>
                  <h3 className="font-display text-base font-semibold text-snow">{t(n.t)}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-mist">{t(n.d)}</p>
                </div>
                <code className="hidden shrink-0 rounded-md border border-ink-line bg-ink px-2.5 py-1 font-code text-[0.7rem] text-accent-cyan sm:block">
                  {n.code}
                </code>
              </motion.div>

              {i < ARCH_NODES.length - 1 && (
                <div className="flex justify-center py-1" aria-hidden="true">
                  <motion.div
                    initial={reduced ? { scaleY: 1 } : { scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="h-8 w-px origin-top bg-gradient-to-b from-accent-blue/70 to-accent-violet/70"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

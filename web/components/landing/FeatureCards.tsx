// SPDX-License-Identifier: Apache-2.0
/** "Why SolVerdict" — six premium cards with animated icons. */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Blocks, FlaskConical, GitBranch, RefreshCw, Scale, ShieldCheck, type LucideIcon } from "lucide-react";
import { useLang } from "../LangProvider";
import { Reveal, SectionHeading } from "./ui";
import type { TKey } from "../../lib/i18n";

const CARDS: Array<{ icon: LucideIcon; title: TKey; body: TKey; tint: string }> = [
  { icon: Scale, title: "land.why.c1.t", body: "land.why.c1.b", tint: "text-accent-blue" },
  { icon: RefreshCw, title: "land.why.c2.t", body: "land.why.c2.b", tint: "text-accent-cyan" },
  { icon: Blocks, title: "land.why.c3.t", body: "land.why.c3.b", tint: "text-accent-violet" },
  { icon: ShieldCheck, title: "land.why.c4.t", body: "land.why.c4.b", tint: "text-state-ok" },
  { icon: GitBranch, title: "land.why.c5.t", body: "land.why.c5.b", tint: "text-accent-blue" },
  { icon: FlaskConical, title: "land.why.c6.t", body: "land.why.c6.b", tint: "text-accent-cyan" },
];

export function FeatureCards() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
      <SectionHeading eyebrow={t("land.why.eyebrow")} title={t("land.why.h2")} />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <Reveal key={c.title} delay={0.06 * i}>
              <motion.article
                whileHover={reduced ? undefined : { y: -5 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
                className="group h-full rounded-2xl border border-ink-line bg-ink-card/70 p-6 shadow-lg shadow-black/20 transition-colors hover:border-mist/30 hover:bg-ink-card"
              >
                <div className="inline-flex rounded-xl border border-ink-line bg-ink-surface p-3">
                  <motion.span
                    className={c.tint}
                    whileHover={reduced ? undefined : { rotate: 8, scale: 1.08 }}
                    transition={{ type: "spring", stiffness: 300, damping: 15 }}
                  >
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </motion.span>
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold text-snow">{t(c.title)}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-mist">{t(c.body)}</p>
              </motion.article>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

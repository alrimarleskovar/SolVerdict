// SPDX-License-Identifier: Apache-2.0
/** "Why SolVerdict" — six cards, one idea each. Hover is a quiet CSS lift. */
"use client";

import { Blocks, FlaskConical, GitBranch, RefreshCw, Scale, ShieldCheck, type LucideIcon } from "lucide-react";
import { useLang } from "../LangProvider";
import { Reveal, SectionHeading } from "./ui";
import type { TKey } from "../../lib/i18n";

const CARDS: Array<{ icon: LucideIcon; title: TKey; body: TKey; tint: string }> = [
  { icon: Scale, title: "land.why.c1.t", body: "land.why.c1.b", tint: "text-brand-blue" },
  { icon: RefreshCw, title: "land.why.c2.t", body: "land.why.c2.b", tint: "text-brand-cyan" },
  { icon: Blocks, title: "land.why.c3.t", body: "land.why.c3.b", tint: "text-brand-purple" },
  { icon: ShieldCheck, title: "land.why.c4.t", body: "land.why.c4.b", tint: "text-state-ok" },
  { icon: GitBranch, title: "land.why.c5.t", body: "land.why.c5.b", tint: "text-brand-blue" },
  { icon: FlaskConical, title: "land.why.c6.t", body: "land.why.c6.b", tint: "text-brand-cyan" },
];

export function FeatureCards() {
  const { t } = useLang();

  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
      <SectionHeading eyebrow={t("land.why.eyebrow")} title={t("land.why.h2")} titleMax="max-w-none" />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <Reveal key={c.title} delay={0.05 * i} className="h-full">
              <article className="h-full rounded-2xl border border-ink-line bg-ink-card/60 p-6 shadow-lg shadow-black/20 transition-all duration-200 ease-brand hover:-translate-y-1 hover:border-mist/20 hover:bg-ink-card">
                <div className="inline-flex rounded-xl border border-ink-line bg-ink-surface p-3">
                  <Icon className={`h-6 w-6 ${c.tint}`} aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-snow">{t(c.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{t(c.body)}</p>
              </article>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

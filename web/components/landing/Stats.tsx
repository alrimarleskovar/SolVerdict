// SPDX-License-Identifier: Apache-2.0
/** Trust strip: six real Run B numbers with animated count-up. */
"use client";

import { useLang } from "../LangProvider";
import { STATS } from "./data";
import { Counter, Reveal } from "./ui";

export function Stats() {
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-20" aria-label={t("land.stats.eyebrow")}>
      <Reveal>
        <p className="mb-8 text-center font-code text-xs uppercase tracking-[0.2em] text-mist">
          {t("land.stats.eyebrow")}
        </p>
      </Reveal>
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-ink-line bg-ink-surface/40 sm:grid-cols-3 lg:grid-cols-6">
        {STATS.map((s, i) => (
          <Reveal
            key={s.label}
            delay={0.05 * i}
            className="border-b border-r border-ink-line p-6 text-center last:border-r-0 sm:[&:nth-child(3n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(3n)]:border-r lg:last:border-r-0"
          >
            <span className="block font-display text-3xl font-bold tracking-tight text-snow sm:text-4xl">
              <Counter value={s.value} suffix={s.suffix ?? ""} />
            </span>
            <span className="mt-2 block text-xs leading-snug text-mist">{t(s.label)}</span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

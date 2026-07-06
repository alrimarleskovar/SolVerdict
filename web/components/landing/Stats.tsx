// SPDX-License-Identifier: Apache-2.0
/** Trust strip: six real Run B numbers with a single count-up pass. */
"use client";

import { useLang } from "../LangProvider";
import { STATS } from "./data";
import { Counter, Reveal } from "./ui";

export function Stats() {
  const { t } = useLang();
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24" aria-label={t("land.stats.eyebrow")}>
      <Reveal>
        <p className="mb-8 text-center font-code text-[13px] uppercase tracking-[0.2em] text-mist">
          {t("land.stats.eyebrow")}
        </p>
      </Reveal>
      <Reveal delay={0.1}>
        <div className="strip grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <span className="block font-display text-[28px] font-bold leading-[1.2] tracking-tight text-snow sm:text-[32px]">
                <Counter value={s.value} suffix={s.suffix ?? ""} />
              </span>
              <span className="mt-2 block text-[13px] leading-snug text-mist">{t(s.label)}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark results — the real v0.2.2 Run B table (4 setups × 5 categories),
 * with medals for the top 3 and explicit honesty notes: partial coverage is
 * marked, the floor is unranked, and absence of data is never shown as
 * containment. Numbers cite report/results-OFFICIAL-v022-runB-0149.json.
 */
"use client";

import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { useLang } from "../LangProvider";
import { LINKS, RUN_B, type Tier } from "./data";
import { Reveal, SectionHeading } from "./ui";

const MEDAL_TINT: Record<1 | 2 | 3, string> = {
  1: "text-amber-400",
  2: "text-slate-300",
  3: "text-amber-700",
};

const CELL_CLS: Record<Tier, string> = {
  ok: "border-state-ok/30 bg-state-ok/10 text-state-ok",
  warn: "border-state-warn/30 bg-state-warn/10 text-state-warn",
  bad: "border-state-bad/30 bg-state-bad/10 text-state-bad",
  na: "border-ink-line bg-ink text-mist italic",
};

export function Leaderboard() {
  const { t } = useLang();

  return (
    <section id="results" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-24">
      <SectionHeading eyebrow={t("land.lb.eyebrow")} title={t("land.lb.h2")} />

      <Reveal delay={0.1}>
        <div className="mt-10 overflow-x-auto rounded-2xl border border-ink-line bg-ink-card/60 shadow-xl shadow-black/25">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">{t("land.lb.h2")}</caption>
            <thead>
              <tr className="border-b border-ink-line">
                <th scope="col" className="px-5 py-4 font-code text-xs font-medium uppercase tracking-widest text-mist">
                  #
                </th>
                <th scope="col" className="px-4 py-4 font-code text-xs font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.setup")}
                </th>
                <th scope="col" className="px-4 py-4 font-code text-xs font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.framework")}
                </th>
                <th scope="col" className="px-4 py-4 font-code text-xs font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.model")}
                </th>
                <th scope="col" className="px-4 py-4 font-code text-xs font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.containment")}
                </th>
              </tr>
            </thead>
            <tbody>
              {RUN_B.map((row) => (
                <tr
                  key={row.setup}
                  className={`border-b border-ink-line/60 transition-colors last:border-b-0 hover:bg-ink-surface/50 ${
                    row.flag === "floor" ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-5 py-4">
                    {row.rank ? (
                      <Trophy className={`h-5 w-5 ${MEDAL_TINT[row.rank]}`} aria-label={`Rank ${row.rank}`} />
                    ) : (
                      <span className="font-code text-xs text-mist">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-code text-sm text-snow">{row.setup}</span>
                    {row.flag && (
                      <span className="ml-2 rounded-full border border-state-warn/40 bg-state-warn/10 px-2 py-0.5 font-code text-[0.62rem] uppercase tracking-wider text-state-warn">
                        {row.flag === "partial" ? t("land.lb.partial") : t("land.lb.floor")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-sm text-mist">{row.framework}</td>
                  <td className="px-4 py-4 font-code text-xs text-mist">{row.model}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {row.cells.map((c, i) => (
                        <span
                          key={i}
                          className={`rounded-md border px-2 py-1 font-code text-[0.68rem] ${CELL_CLS[c.tier]}`}
                          title={`Category ${"ABCDE"[i]}`}
                        >
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-mist">
          {t("land.lb.note")}{" "}
          <a href={LINKS.runBJson} target="_blank" rel="noreferrer" className="text-accent-cyan hover:text-snow">
            results-OFFICIAL-v022-runB-0149.json ↗
          </a>
        </p>
        <Link
          href={LINKS.leaderboard}
          className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-accent-blue transition-colors hover:text-snow"
        >
          {t("land.lb.cta")}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </Reveal>
    </section>
  );
}

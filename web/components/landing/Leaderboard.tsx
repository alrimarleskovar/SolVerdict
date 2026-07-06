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
  1: "text-state-warn",
  2: "text-mist",
  3: "text-state-warn/60",
};

const CELL_CLS: Record<Tier, string> = {
  ok: "border-state-ok/20 bg-state-ok/10 text-state-ok",
  warn: "border-state-warn/20 bg-state-warn/10 text-state-warn",
  bad: "border-state-bad/20 bg-state-bad/10 text-state-bad",
  na: "border-ink-line bg-ink text-mist italic",
};

export function Leaderboard() {
  const { t } = useLang();

  return (
    <section id="results" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16 sm:py-24">
      <SectionHeading eyebrow={t("land.lb.eyebrow")} title={t("land.lb.h2")} titleMax="max-w-none" />

      <Reveal delay={0.1}>
        <div className="mt-12 overflow-x-auto rounded-2xl border border-ink-line bg-ink-card/60 shadow-lg shadow-black/20">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">{t("land.lb.h2")}</caption>
            <thead>
              <tr className="border-b border-ink-line">
                <th scope="col" className="px-6 py-4 font-code text-[13px] font-medium uppercase tracking-widest text-mist">
                  #
                </th>
                <th scope="col" className="px-4 py-4 font-code text-[13px] font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.setup")}
                </th>
                <th scope="col" className="px-4 py-4 font-code text-[13px] font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.framework")}
                </th>
                <th scope="col" className="px-4 py-4 font-code text-[13px] font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.model")}
                </th>
                <th scope="col" className="px-4 py-4 font-code text-[13px] font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.containment")}
                </th>
              </tr>
            </thead>
            <tbody>
              {RUN_B.map((row) => (
                <tr
                  key={row.setup}
                  className={`border-b border-ink-line transition-colors duration-200 ease-brand last:border-b-0 hover:bg-ink-surface/60 ${
                    row.flag === "floor" ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-6 py-4">
                    {row.rank ? (
                      <Trophy className={`h-4 w-4 ${MEDAL_TINT[row.rank]}`} aria-label={`Rank ${row.rank}`} />
                    ) : (
                      <span className="font-code text-[13px] text-mist">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {/* Single-line cell: setup id + nowrap pill side by side —
                        every row keeps the same height; the pill never breaks
                        mid-phrase. Wide content scrolls via the table's
                        overflow-x container, it never wraps. */}
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="font-code text-sm text-snow">{row.setup}</span>
                      {row.flag && (
                        <span className="whitespace-nowrap rounded-lg border border-state-warn/40 bg-state-warn/10 px-2 py-1 font-code text-[13px] uppercase tracking-wider text-state-warn">
                          {row.flag === "partial" ? t("land.lb.partial") : t("land.lb.floor")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-mist">{row.framework}</td>
                  <td className="px-4 py-4 font-code text-[13px] text-mist">{row.model}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      {row.cells.map((c, i) => (
                        <span key={i} className={`rounded-lg border px-2 py-1 font-code text-[13px] ${CELL_CLS[c.tier]}`} title={`Category ${"ABCDE"[i]}`}>
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

      <Reveal delay={0.15}>
        {/* legend/source note spans the full table width */}
        <p className="mt-6 text-[13px] leading-relaxed text-mist">
          {t("land.lb.note")}{" "}
          <a
            href={LINKS.runBJson}
            target="_blank"
            rel="noreferrer"
            className="text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow"
          >
            results-OFFICIAL-v022-runB-0149.json ↗
          </a>
        </p>
        <Link
          href={LINKS.leaderboard}
          className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-accent-blue transition-colors duration-200 ease-brand hover:text-accent-cyan"
        >
          {t("land.lb.cta")}
          <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1" aria-hidden="true" />
        </Link>
      </Reveal>
    </section>
  );
}

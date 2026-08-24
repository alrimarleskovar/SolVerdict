// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark results, v2 — the same official v0.3.0 data (RUN_V030, 4 setups ×
 * 6 categories) laid out so the six containment values fit without a scrollbar.
 *
 * WHY IT IS A FORK: it was written while landing/Leaderboard was still the
 * mounted one and had to keep working. That original is now unreferenced and
 * slated for deletion, at which point this can lose the V2.
 *
 * THE PROBLEM, MEASURED. v1 sets min-w-[760px] but really needs ~1250px:
 * 64 (#) + ~388 (setup + flag pill) + ~90 (framework) + ~60 (model) + ~648
 * (six w-24 chips + gaps). The hero container gives 1104px, so the table
 * overflowed by ~150px — and the columns pushed off the right edge were the
 * containment values, i.e. the entire point of the section.
 *
 * WHAT CHANGED, in order of how much width each returned:
 *
 *   1. The chips were w-24 (96px) holding "100%", "81.7%" or "n/a" — 4 to 5
 *      characters in a 96px box. They now size to a 76px column cap, which
 *      alone gave back ~270px.
 *   2. Framework and Model stop being columns and become one subtitle under
 *      the setup id ("Solana Agent Kit v2 · claude-sonnet-4-6"). They were
 *      also the two columns that wrapped to two and three lines, so the rows
 *      get shorter as well as narrower. Nothing is lost: both are still
 *      printed verbatim for every row.
 *   3. Each category gets a real <th scope="col"> — the letter, which is the
 *      prereg identifier, over the label. That reads better than v1's single
 *      merged "Containment by category (A / B / C / D / E / F)" header, and it
 *      needs no legend, because the word is already in the column head.
 *
 * Total: ~64 + ~357 + ~534 = ~955px against 1104px available.
 *
 * WHAT IS LOAD-BEARING AND STAYS. The capability-gap pill on both SAK rows,
 * the n/a cells with their own tier styling, and baseline-scripted rendered as
 * the floor. A reader seeing 100% in four categories and nothing in two has to
 * be able to find out why, and land.lb.note — kept verbatim — is where that is
 * explained. n/a is never rendered as a number and never as a failure.
 *
 * BELOW lg THE TABLE IS NOT A TABLE. Eight columns cannot honestly fit 390px,
 * and a horizontal scrollbar there would recreate the original bug on the
 * device where it hurts most. Each setup becomes a card with its six values in
 * a 3×2 grid, each tile carrying its own category label — so the narrow layout
 * needs neither a scrollbar nor a legend either.
 *
 * THE BREAKPOINT IS lg, NOT sm, and that is a measurement rather than a taste:
 * the colgroup's six 104px columns plus the 52px rank column are 676px of
 * FIXED width. At 1024px the container is 976px and the setup column still
 * gets 300px, which is more than its longest min-content (the unbreakable
 * "baseline-scripted", ~167px with padding). At 768px the container is 720px,
 * the fixed columns would leave the setup column 44px, and a table-fixed
 * layout whose declared widths exceed the table pushes the overflow onto the
 * page — reintroducing the scrollbar one breakpoint lower. So the table starts
 * exactly where it fits and the cards cover everything below it.
 */
"use client";

import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { useLang } from "../../LangProvider";
import { LINKS, RUN_V030, type Tier } from "../data";
import { CATEGORIES } from "../../../lib/placard-model";
import { Reveal, SectionHeading } from "../ui";
import type { TKey } from "../../../lib/i18n";

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

/** Index-aligned with CATEGORIES. The letter is invariant, the word is not. */
const CAT_KEYS: TKey[] = ["land2.cat.a", "land2.cat.b", "land2.cat.c", "land2.cat.d", "land2.cat.e", "land2.cat.f"];

const FLAG_PILL =
  "whitespace-nowrap rounded-md border border-state-warn/40 bg-state-warn/10 px-2 py-0.5 font-code text-[10px] uppercase tracking-wider text-state-warn";

export function LeaderboardV2() {
  const { t } = useLang();
  const flagLabel = (flag: "capability" | "floor") =>
    flag === "capability" ? t("land.lb.capability") : t("land.lb.floor");

  return (
    <section id="results" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-16 sm:py-24">
      <SectionHeading eyebrow={t("land.lb.eyebrow")} title={t("land.lb.h2")} titleMax="max-w-none" />

      {/* ---------- lg and up: the table ---------- */}
      <Reveal delay={0.1}>
        <div className="mt-12 hidden rounded-2xl border border-ink-line bg-ink-card/60 shadow-lg shadow-black/20 lg:block">
          {/* No overflow-x wrapper and no min-w: if a future change makes this
              too wide again it must be fixed, not hidden behind a scrollbar. */}
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">{t("land.lb.h2")}</caption>
            {/* Widths declared HERE, not on the first header row. `table-fixed`
                takes its column widths from row one, and row one's spanning
                "containment by category" cell cannot express six of them — so
                the six category columns fell back to an even split and dragged
                the setup column down with them, wrapping "model-only-claude"
                across two lines. A colgroup is the only place that sizes a
                fixed table independently of what the header rows look like.
                52 + 6×104 = 676 leaves the setup column ~428px, which fits the
                longest id and its longest flag pill on one line in both
                locales ("baseline-scripted" + "floor / negative control" is
                ~345px including padding) while spending the rest on the values
                rather than on a gap between the setup name and column A. */}
            <colgroup>
              <col className="w-[52px]" />
              <col />
              {CATEGORIES.map((c) => (
                <col key={c} className="w-[104px]" />
              ))}
            </colgroup>
            <thead>
              {/* Two header rows: the spanning row keeps the word "containment"
                  attached to the six columns, which the per-letter headers on
                  their own would drop. */}
              <tr className="border-b border-ink-line/60 bg-ink-surface">
                <th className="px-4 pt-3" />
                <th className="px-3 pt-3" />
                <th
                  colSpan={CATEGORIES.length}
                  scope="colgroup"
                  className="px-3 pt-3 text-center font-code text-[11px] font-medium uppercase tracking-[0.16em] text-mist/70"
                >
                  {t("land2.lb.col.cat")}
                </th>
              </tr>
              <tr className="border-b border-ink-line bg-ink-surface">
                <th scope="col" className="px-4 pb-3 pt-2 font-code text-[12px] font-medium uppercase tracking-widest text-mist">
                  #
                </th>
                <th scope="col" className="px-3 pb-3 pt-2 font-code text-[12px] font-medium uppercase tracking-widest text-mist">
                  {t("land.lb.col.setup")}
                </th>
                {CATEGORIES.map((c, i) => (
                  <th key={c} scope="col" className="px-1.5 pb-3 pt-2 text-center">
                    <span className="block font-code text-[13px] font-semibold text-snow">{c}</span>
                    <span className="mt-0.5 block font-code text-[10px] uppercase leading-tight tracking-[0.06em] text-mist/60">
                      {t(CAT_KEYS[i])}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RUN_V030.map((row) => (
                <tr
                  key={row.setup}
                  className={`border-b border-ink-line transition-colors duration-200 ease-brand last:border-b-0 hover:bg-ink-surface/60 ${
                    row.flag === "floor" ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    {row.rank ? (
                      <Trophy className={`h-4 w-4 ${MEDAL_TINT[row.rank]}`} aria-label={`Rank ${row.rank}`} />
                    ) : (
                      <span className="font-code text-[13px] text-mist">—</span>
                    )}
                  </td>
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    {/* flex-wrap, not nowrap: the pill drops below the id
                        rather than forcing the column wider. */}
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-code text-sm text-snow">{row.setup}</span>
                      {row.flag && <span className={FLAG_PILL}>{flagLabel(row.flag)}</span>}
                    </span>
                    <span className="mt-1 block font-code text-[11px] leading-snug text-mist/60">
                      {row.framework} · {row.model}
                    </span>
                  </th>
                  {row.cells.map((c, i) => (
                    <td key={i} className="px-1.5 py-3 text-center">
                      <span
                        className={`inline-flex h-7 w-full items-center justify-center whitespace-nowrap rounded-lg border px-1 font-code text-[13px] ${CELL_CLS[c.tier]}`}
                      >
                        {c.label}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      {/* ---------- below lg: one card per setup ---------- */}
      <div className="mt-10 space-y-4 lg:hidden">
        {RUN_V030.map((row, r) => (
          <Reveal key={row.setup} delay={0.06 * r}>
            <div
              className={`rounded-2xl border border-ink-line bg-ink-card/60 p-4 ${
                row.flag === "floor" ? "opacity-60" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {row.rank ? (
                  <Trophy className={`h-4 w-4 shrink-0 ${MEDAL_TINT[row.rank]}`} aria-label={`Rank ${row.rank}`} />
                ) : (
                  <span className="font-code text-[13px] text-mist">—</span>
                )}
                <span className="font-code text-sm text-snow">{row.setup}</span>
                {row.flag && <span className={FLAG_PILL}>{flagLabel(row.flag)}</span>}
              </div>
              <p className="mt-1 font-code text-[11px] leading-snug text-mist/60">
                {row.framework} · {row.model}
              </p>
              {/* The tile itself carries the tier colour, so each value keeps
                  its label instead of depending on a column head that does not
                  exist at this width. */}
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {row.cells.map((c, i) => (
                  <div key={i} className={`rounded-lg border px-1.5 py-2 text-center ${CELL_CLS[c.tier]}`}>
                    <dt className="font-code text-[9px] uppercase leading-tight tracking-[0.06em] opacity-70">
                      {CATEGORIES[i]} · {t(CAT_KEYS[i])}
                    </dt>
                    <dd className="mt-1 font-code text-[13px]">{c.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.15}>
        {/* The n/a explanation and the floor's meaning live here, verbatim. */}
        <p className="mt-6 text-[13px] leading-relaxed text-mist">
          {t("land.lb.note")}{" "}
          <a
            href={LINKS.resultsJson}
            target="_blank"
            rel="noreferrer"
            className="text-brand-cyan transition-colors duration-200 ease-brand hover:text-snow"
          >
            results-OFFICIAL-v030-run1-2103.json ↗
          </a>
        </p>
        <Link
          href={LINKS.leaderboard}
          className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand-blue transition-colors duration-200 ease-brand hover:text-brand-cyan"
        >
          {t("land.lb.cta")}
          <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1" aria-hidden="true" />
        </Link>
      </Reveal>
    </section>
  );
}

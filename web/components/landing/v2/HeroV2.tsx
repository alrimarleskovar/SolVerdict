// SPDX-License-Identifier: Apache-2.0
/**
 * Hero, v2 — the inversion: the product is the offer, the benchmark is the
 * proof underneath it.
 *
 * THE H1 IS THE OFFER, THE SUB IS THE PRODUCT, AND THE FINDING IS ITS OWN
 * LINE. The hero's single colour accent therefore sits on the count inside the
 * finding — the one figure a reader could not have guessed — and the headline
 * stays plain snow. No gradient text: the v1 hero put its gradient on "secure
 * Solana AI agents", which was the pitch, and a brand gradient over a wallet
 * drain would read as celebratory.
 *
 * TWO buttons, not three: GitHub already lives in the navbar, so a third
 * above-the-fold action would only dilute "Audit my agent".
 *
 * BADGES LINK TO WHAT SUBSTANTIATES THEM. "Framework-agnostic" is gone — it
 * contradicts a headline whose whole finding is that the framework decides the
 * outcome, and only one framework adapter ships. "Pre-registered rubric" takes
 * its place and leads the row, because it answers the objection this specific
 * H1 provokes: that the test was designed after the result was known.
 *
 * The citation and the association caveat sit IN the hero rather than in a
 * footnote further down. The H1 states a measured failure of a named
 * third-party framework; the reader is entitled to its provenance and its
 * limits in the same glance, and the repo's own standard (README "What this
 * design supports", data.ts) is that this pairing is association, not mechanism.
 */
"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLang } from "../../LangProvider";
import { LINKS } from "../data";
import { EASE, DUR } from "../ui";
import { VerdictPanel } from "./VerdictPanel";
import type { TKey } from "../../../lib/i18n";

/** Each badge points at the artifact that backs it — a claim you can open. */
const BADGES: Array<{ key: TKey | null; literal?: string; href: string; external: boolean }> = [
  { key: "land2.badge.prereg", href: LINKS.prereg, external: true },
  { key: "land.badge.det", href: LINKS.methodology, external: false },
  { key: null, literal: "Apache-2.0", href: LINKS.license, external: true },
];

export function HeroV2() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  const item = (i: number) => ({
    initial: reduced ? false : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.normal, delay: 0.08 * i, ease: EASE },
  });

  const badgeCls =
    "block rounded-lg border border-ink-line bg-ink-surface/40 px-3 py-1 font-code text-[13px] uppercase tracking-[0.1em] text-mist transition-colors duration-200 ease-brand hover:border-mist/40 hover:text-snow";

  return (
    <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="min-w-0">
          <motion.p
            {...item(0)}
            // text-balance + a measure: the EN string is long enough to wrap at
            // this column width and was dropping "AGENTS" alone onto line two.
            // PT fits on one line and is unaffected.
            className="max-w-lg text-balance font-code text-[12px] uppercase tracking-[0.18em] text-brand-cyan sm:text-[13px]"
          >
            {t("land2.hero.eyebrow")}
          </motion.p>

          <motion.h1
            {...item(1)}
            className="mt-4 text-balance font-display text-[32px] font-extrabold leading-[1.12] tracking-tight text-snow sm:text-[42px] lg:text-[48px]"
          >
            {t("land2.hero.h1")}
          </motion.h1>

          <motion.p {...item(2)} className="mt-6 max-w-xl text-base leading-relaxed text-mist sm:text-lg">
            {t("land2.hero.sub")}
          </motion.p>

          <motion.div {...item(3)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={LINKS.submit}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-blue to-brand-purple px-6 py-3 text-base font-semibold text-snow shadow-lg shadow-black/20 transition-all duration-200 ease-brand hover:-translate-y-px hover:shadow-black/40"
            >
              {t("land2.hero.cta")}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            {/* The label now names a destination rather than a section, so it
                goes to /methodology instead of scrolling to #results. */}
            <Link
              href={LINKS.methodology}
              className="inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink-surface/60 px-6 py-3 text-base font-semibold text-snow transition-colors duration-200 ease-brand hover:border-mist/40 hover:bg-ink-surface"
            >
              {t("land2.hero.cta2")}
            </Link>
          </motion.div>

          <motion.ul {...item(4)} className="mt-8 flex flex-wrap gap-2" aria-label="Project properties">
            {BADGES.map((b) => {
              const label = b.key ? t(b.key) : (b.literal as string);
              return (
                <li key={label}>
                  {b.external ? (
                    <a href={b.href} target="_blank" rel="noreferrer" className={badgeCls}>
                      {label}
                    </a>
                  ) : (
                    <Link href={b.href} className={badgeCls}>
                      {label}
                    </Link>
                  )}
                </li>
              );
            })}
          </motion.ul>

          {/* THE FINDING, AND THE ANSWER TO IT. The citation that used to sit
              under it was redundant with the live-examples section's own note,
              which already carries the setups, the counts and N; the association
              caveat moved down to sit with those examples (FindingCaveat)
              rather than being dropped, since it was the only copy on the site
              making that qualification.

              The differentiator moved here from under the CTAs. It reads as the
              reply to "Will yours?" — the finding poses the reader's open
              question and the next line says who settles it and how — so both
              sit inside the one rule rather than the answer floating loose
              below it. */}
          <motion.div {...item(5)} className="mt-8 max-w-xl border-l-2 border-ink-line pl-5">
            <p className="text-[15px] leading-relaxed text-mist sm:text-base">
              {t("land2.hero.find.a")}{" "}
              {/* nowrap: the count is the payload of the sentence and must not
                  break across lines. Short in both languages, so it can never
                  overflow the measure. */}
              <span className="whitespace-nowrap font-semibold text-state-bad">{t("land2.hero.find.b")}</span>{" "}
              {t("land2.hero.find.c")} <span className="font-semibold text-snow">{t("land2.hero.find.q")}</span>
            </p>
            {/* font-code and snow: our own voice, not more of the finding. */}
            <p className="mt-3 font-code text-[13px] text-snow">{t("land2.hero.diff")}</p>
          </motion.div>
        </div>

        <motion.div
          className="min-w-0"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.normal, delay: 0.24, ease: EASE }}
        >
          <VerdictPanel />
        </motion.div>
      </div>
    </section>
  );
}

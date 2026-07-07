// SPDX-License-Identifier: Apache-2.0
/** Hero: the dominant H1, positioning subtitle, two CTAs, property badges,
 *  and the telemetry panel. One entrance sequence — nothing else moves. */
"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLang } from "../LangProvider";
import { GitHubIcon } from "./Navbar";
import { HeroDashboard } from "./HeroDashboard";
import { LINKS } from "./data";
import { EASE, DUR } from "./ui";

export function Hero() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  const item = (i: number) => ({
    initial: reduced ? false : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.normal, delay: 0.08 * i, ease: EASE },
  });

  const badges = ["Apache-2.0", t("land.badge.oss"), t("land.badge.det"), t("land.badge.agnostic")];

  return (
    <section className="relative mx-auto max-w-6xl px-6 pb-12 pt-16 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="min-w-0">
          <motion.h1
            {...item(0)}
            className="font-display text-[40px] font-extrabold leading-[1.1] tracking-tight text-snow sm:text-[56px] lg:text-[64px]"
          >
            {t("land.hero.h1a")}{" "}
            <span className="bg-gradient-to-r from-accent-blue via-accent-cyan to-accent-violet bg-clip-text text-transparent">
              {t("land.hero.h1b")}
            </span>
          </motion.h1>

          <motion.p {...item(1)} className="mt-6 max-w-xl text-base leading-relaxed text-mist sm:text-lg">
            {t("land.hero.sub")}
          </motion.p>

          <motion.div {...item(2)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={LINKS.submit}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-accent-blue to-accent-violet px-6 py-3 text-base font-semibold text-snow shadow-lg shadow-black/20 transition-all duration-200 ease-brand hover:-translate-y-px hover:shadow-black/40"
            >
              {t("land.nav.run")}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <a
              href={LINKS.repo}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink-surface/60 px-6 py-3 text-base font-semibold text-snow transition-colors duration-200 ease-brand hover:border-mist/40 hover:bg-ink-surface"
            >
              <GitHubIcon className="h-4 w-4" />
              GitHub
            </a>
          </motion.div>

          <motion.ul {...item(3)} className="mt-8 flex flex-wrap gap-2" aria-label="Project properties">
            {badges.map((b) => (
              <li
                key={b}
                className="rounded-lg border border-ink-line bg-ink-surface/40 px-3 py-1 font-code text-[13px] uppercase tracking-[0.1em] text-mist"
              >
                {b}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div
          className="min-w-0"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.normal, delay: 0.24, ease: EASE }}
        >
          <HeroDashboard />
        </motion.div>
      </div>
    </section>
  );
}

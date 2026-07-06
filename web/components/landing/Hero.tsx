// SPDX-License-Identifier: Apache-2.0
/** Hero: massive display headline, positioning subtitle, CTAs, trust badges,
 *  and the animated evaluation dashboard on the right. */
"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLang } from "../LangProvider";
import { GitHubIcon } from "./Navbar";
import { HeroDashboard } from "./HeroDashboard";
import { LINKS } from "./data";

export function Hero() {
  const { t } = useLang();
  const reduced = useReducedMotion();

  const item = (i: number) => ({
    initial: reduced ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, delay: 0.08 * i, ease: [0.21, 0.65, 0.36, 1] as [number, number, number, number] },
  });

  const badges = [
    "Apache-2.0",
    t("land.badge.oss"),
    t("land.badge.det"),
    t("land.badge.agnostic"),
  ];

  return (
    <section className="relative mx-auto max-w-6xl px-5 pb-10 pt-16 sm:pt-24">
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <motion.h1
            {...item(0)}
            className="font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-tight text-snow sm:text-6xl"
          >
            {t("land.hero.h1a")}{" "}
            <span className="bg-gradient-to-r from-accent-blue via-accent-cyan to-accent-violet bg-clip-text text-transparent">
              {t("land.hero.h1b")}
            </span>
          </motion.h1>

          <motion.p {...item(1)} className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
            {t("land.hero.sub")}
          </motion.p>

          <motion.div {...item(2)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={LINKS.submit}
              className="group inline-flex items-center gap-2 rounded-xl bg-accent-blue px-6 py-3 text-base font-semibold text-snow shadow-xl shadow-accent-blue/25 transition-all hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-accent-blue/40"
            >
              {t("land.nav.run")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <a
              href={LINKS.repo}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink-surface/60 px-6 py-3 text-base font-semibold text-snow transition-all hover:-translate-y-0.5 hover:border-mist/40 hover:bg-ink-surface"
            >
              <GitHubIcon className="h-5 w-5" />
              GitHub
            </a>
          </motion.div>

          <motion.ul {...item(3)} className="mt-8 flex flex-wrap gap-2" aria-label="Project properties">
            {badges.map((b) => (
              <li
                key={b}
                className="rounded-full border border-ink-line bg-ink-surface/50 px-3 py-1 font-code text-[0.7rem] uppercase tracking-[0.1em] text-mist"
              >
                {b}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.21, 0.65, 0.36, 1] }}
        >
          <HeroDashboard />
        </motion.div>
      </div>
    </section>
  );
}

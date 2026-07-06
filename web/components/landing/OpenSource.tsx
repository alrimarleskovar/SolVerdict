// SPDX-License-Identifier: Apache-2.0
/** Open-source card: Apache-2.0, real quickstart commands, contribution links. */
"use client";

import { BookOpen, GitFork, Puzzle } from "lucide-react";
import { useLang } from "../LangProvider";
import { LINKS, OSS_COMMANDS } from "./data";
import { Reveal, SectionHeading } from "./ui";
import Link from "next/link";

export function OpenSource() {
  const { t } = useLang();

  const actions = [
    { icon: GitFork, label: t("land.oss.fork"), href: LINKS.fork, external: true },
    { icon: BookOpen, label: t("land.oss.contribute"), href: LINKS.contributing, external: true },
    { icon: Puzzle, label: t("land.oss.adapter"), href: LINKS.docs, external: false },
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
      <Reveal>
        <div className="overflow-hidden rounded-3xl border border-ink-line bg-gradient-to-br from-ink-surface to-ink-card shadow-2xl shadow-black/30">
          <div className="grid gap-10 p-8 sm:p-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="font-code text-xs uppercase tracking-[0.2em] text-accent-cyan">{t("land.oss.eyebrow")}</p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-snow sm:text-4xl">
                {t("land.oss.h2")}
              </h2>
              <p className="mt-4 max-w-xl leading-relaxed text-mist">{t("land.oss.body")}</p>

              <div className="mt-8 flex flex-wrap gap-3">
                {actions.map((a) => {
                  const Icon = a.icon;
                  const cls =
                    "inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink/60 px-4 py-2.5 text-sm font-medium text-snow transition-all hover:-translate-y-0.5 hover:border-mist/40";
                  return a.external ? (
                    <a key={a.label} href={a.href} target="_blank" rel="noreferrer" className={cls}>
                      <Icon className="h-4 w-4 text-accent-cyan" aria-hidden="true" />
                      {a.label}
                    </a>
                  ) : (
                    <Link key={a.label} href={a.href} className={cls}>
                      <Icon className="h-4 w-4 text-accent-cyan" aria-hidden="true" />
                      {a.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* real quickstart */}
            <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink shadow-inner">
              <div className="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
                <span className="font-code text-[0.68rem] uppercase tracking-widest text-mist">quickstart</span>
                <span className="rounded-full border border-ink-line px-2.5 py-0.5 font-code text-[0.62rem] text-mist">
                  Apache-2.0
                </span>
              </div>
              <pre className="overflow-x-auto p-5 font-code text-[0.78rem] leading-7 text-snow/90">
                {OSS_COMMANDS.map((c) => (
                  <div key={c}>
                    <span className="select-none text-accent-cyan">$ </span>
                    {c}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

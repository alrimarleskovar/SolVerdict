// SPDX-License-Identifier: Apache-2.0
/** Open-source card: Apache-2.0, real quickstart commands, contribution links. */
"use client";

import Link from "next/link";
import { BookOpen, GitFork, Puzzle } from "lucide-react";
import { useLang } from "../LangProvider";
import { LINKS, OSS_COMMANDS } from "./data";
import { Reveal } from "./ui";

export function OpenSource() {
  const { t } = useLang();

  const actions = [
    { icon: GitFork, label: t("land.oss.fork"), href: LINKS.fork, external: true },
    { icon: BookOpen, label: t("land.oss.contribute"), href: LINKS.contributing, external: true },
    { icon: Puzzle, label: t("land.oss.adapter"), href: LINKS.docs, external: false },
  ];
  const actionCls =
    "inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink/60 px-4 py-3 text-sm font-medium text-snow transition-colors duration-200 ease-brand hover:border-mist/40";

  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
      <Reveal>
        <div className="overflow-hidden rounded-3xl border border-ink-line bg-ink-surface shadow-lg shadow-black/20">
          <div className="grid gap-12 p-8 sm:p-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="font-code text-[13px] uppercase tracking-[0.2em] text-brand-cyan">{t("land.oss.eyebrow")}</p>
              <h2 className="mt-3 font-display text-[28px] font-bold leading-[1.15] tracking-tight text-snow sm:text-[40px]">
                {t("land.oss.h2")}
              </h2>
              <p className="mt-4 max-w-xl leading-relaxed text-mist">{t("land.oss.body")}</p>

              <div className="mt-8 flex flex-wrap gap-3">
                {actions.map((a) => {
                  const Icon = a.icon;
                  return a.external ? (
                    <a key={a.label} href={a.href} target="_blank" rel="noreferrer" className={actionCls}>
                      <Icon className="h-4 w-4 text-brand-cyan" aria-hidden="true" />
                      {a.label}
                    </a>
                  ) : (
                    <Link key={a.label} href={a.href} className={actionCls}>
                      <Icon className="h-4 w-4 text-brand-cyan" aria-hidden="true" />
                      {a.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* real quickstart */}
            <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink">
              <div className="flex items-center justify-between border-b border-ink-line px-4 py-2">
                <span className="font-code text-[13px] uppercase tracking-widest text-mist">quickstart</span>
                <span className="rounded-lg border border-ink-line px-2 py-1 font-code text-[13px] text-mist">Apache-2.0</span>
              </div>
              <pre className="overflow-x-auto p-6 font-code text-[13px] leading-6 text-snow/80">
                {OSS_COMMANDS.map((c) => (
                  <div key={c}>
                    <span className="select-none text-brand-cyan">$ </span>
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

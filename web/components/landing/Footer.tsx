// SPDX-License-Identifier: Apache-2.0
/** Landing footer: brand + tagline, three link columns, the binding
 *  no-money-from-ranked-projects pledge, maintainer and licensing. */
"use client";

import Link from "next/link";
import { useLang } from "../LangProvider";
import { SolVerdictWordmark } from "./Logo";
import { GitHubIcon } from "./Navbar";
import { LINKS } from "./data";
import type { TKey } from "../../lib/i18n";

interface FootLink {
  label: TKey | string;
  href: string;
  external?: boolean;
}

export function Footer() {
  const { t } = useLang();
  const tt = (l: TKey | string) => (l.startsWith("land.") || l.startsWith("home.") ? t(l as TKey) : l);

  const columns: Array<{ head: TKey; links: FootLink[] }> = [
    {
      head: "land.foot.project",
      links: [
        { label: "land.nav.benchmark", href: "/#results" },
        { label: "land.nav.methodology", href: LINKS.methodology },
        { label: "land.nav.leaderboard", href: LINKS.leaderboard },
        { label: "land.nav.run", href: LINKS.submit },
      ],
    },
    {
      head: "land.foot.resources",
      links: [
        { label: "land.nav.docs", href: LINKS.docs },
        { label: "GitHub", href: LINKS.repo, external: true },
        { label: "land.foot.contributing", href: LINKS.contributing, external: true },
        { label: "land.foot.security", href: LINKS.threatModel, external: true },
      ],
    },
    {
      head: "land.foot.integrity",
      links: [
        { label: "land.foot.license", href: LINKS.license, external: true },
        { label: "Run B JSON", href: LINKS.runBJson, external: true },
      ],
    },
  ];

  return (
    <footer className="relative border-t border-ink-line bg-ink-surface/40">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <SolVerdictWordmark />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-mist">{t("land.foot.tagline")}</p>
            <a
              href={LINKS.repo}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ink-line bg-ink/60 px-3 py-2 text-sm font-medium text-snow transition-colors duration-200 ease-brand hover:border-mist/40 hover:bg-ink-surface"
              aria-label="SolVerdict on GitHub"
            >
              <GitHubIcon className="h-5 w-5 shrink-0" />
              <span>SolVerdict</span>
            </a>
          </div>

          {columns.map((col) => (
            <nav key={col.head} aria-label={t(col.head)}>
              <h4 className="font-code text-[13px] uppercase tracking-[0.16em] text-mist/60">{t(col.head)}</h4>
              <ul className="mt-4 space-y-2">
                {col.links.map((l) => (
                  <li key={l.href + String(l.label)}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className="text-sm text-mist transition-colors duration-200 ease-brand hover:text-snow">
                        {tt(l.label)}
                      </a>
                    ) : (
                      <Link href={l.href} className="text-sm text-mist transition-colors duration-200 ease-brand hover:text-snow">
                        {tt(l.label)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-ink-line pt-8">
          {/* pledge flows as one full-width paragraph */}
          <p className="text-[13px] italic leading-relaxed text-mist/80">{t("land.foot.pledge")}</p>
          <div className="mt-4 flex flex-col gap-2 font-code text-[13px] text-mist/60 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 SolVerdict contributors · Apache-2.0 (harness) · CC-BY-4.0 (results)</span>
            <span>{t("home.foot.maintainer")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

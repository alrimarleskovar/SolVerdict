// SPDX-License-Identifier: Apache-2.0
/**
 * Sticky landing navbar: transparent at the top, frosted (blur + hairline)
 * once scrolled. Desktop: inline links + Run-benchmark CTA + EN|PT toggle.
 * Mobile: hamburger with an animated slide-down panel.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useLang } from "../LangProvider";
import { SolVerdictWordmark } from "./Logo";
import { LINKS } from "./data";
import type { TKey } from "../../lib/i18n";

/** GitHub mark (lucide dropped brand icons; minimal inline path). */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.575.106.785-.25.785-.555 0-.274-.01-1-.015-1.965-3.196.695-3.87-1.54-3.87-1.54-.523-1.33-1.277-1.685-1.277-1.685-1.044-.713.08-.698.08-.698 1.155.08 1.762 1.185 1.762 1.185 1.026 1.758 2.692 1.25 3.348.955.104-.743.402-1.25.73-1.538-2.552-.29-5.236-1.276-5.236-5.68 0-1.255.448-2.28 1.183-3.085-.119-.29-.513-1.46.112-3.043 0 0 .965-.31 3.163 1.178a10.98 10.98 0 0 1 2.88-.388c.977.004 1.96.132 2.88.388 2.197-1.488 3.16-1.178 3.16-1.178.627 1.583.233 2.753.114 3.043.737.805 1.182 1.83 1.182 3.085 0 4.415-2.688 5.386-5.25 5.67.413.355.78 1.057.78 2.13 0 1.538-.014 2.778-.014 3.157 0 .308.207.667.79.554A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <span className="inline-flex items-center gap-1 font-code text-xs text-mist" role="group" aria-label="Language">
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`rounded px-1 py-0.5 transition-colors ${lang === "en" ? "font-bold text-snow" : "hover:text-snow"}`}
      >
        EN
      </button>
      <span aria-hidden="true">/</span>
      <button
        type="button"
        onClick={() => setLang("pt")}
        aria-pressed={lang === "pt"}
        className={`rounded px-1 py-0.5 transition-colors ${lang === "pt" ? "font-bold text-snow" : "hover:text-snow"}`}
      >
        PT
      </button>
    </span>
  );
}

const NAV_LINKS: Array<{ key: TKey; href: string; external?: boolean }> = [
  { key: "land.nav.benchmark", href: "#results" },
  { key: "land.nav.methodology", href: LINKS.prereg, external: true },
  { key: "land.nav.docs", href: LINKS.docs },
  { key: "land.nav.leaderboard", href: LINKS.leaderboard },
];

export function Navbar() {
  const { t } = useLang();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const linkCls = "text-sm text-mist transition-colors hover:text-snow";

  return (
    <header
      className={`sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled || open ? "border-b border-ink-line bg-ink/75 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5" aria-label="Primary">
        <Link href="/" className="shrink-0" aria-label="SolVerdict home">
          <SolVerdictWordmark />
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) =>
            l.external ? (
              <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className={linkCls}>
                {t(l.key)}
              </a>
            ) : (
              <Link key={l.key} href={l.href} className={linkCls}>
                {t(l.key)}
              </Link>
            ),
          )}
          <a href={LINKS.repo} target="_blank" rel="noreferrer" className={`${linkCls} inline-flex items-center gap-1.5`}>
            <GitHubIcon className="h-4 w-4" />
            GitHub
          </a>
          <LangToggle />
          <Link
            href={LINKS.submit}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-snow shadow-lg shadow-accent-blue/25 transition-all hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-accent-blue/40"
          >
            {t("land.nav.run")}
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-ink-line text-snow md:hidden"
          aria-label={t("land.nav.menu")}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden border-b border-ink-line bg-ink/95 backdrop-blur-xl md:hidden"
          >
            <div className="flex flex-col gap-1 px-5 pb-5 pt-2">
              {NAV_LINKS.map((l) =>
                l.external ? (
                  <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-2.5 text-mist hover:bg-ink-surface hover:text-snow" onClick={() => setOpen(false)}>
                    {t(l.key)}
                  </a>
                ) : (
                  <Link key={l.key} href={l.href} className="rounded-lg px-2 py-2.5 text-mist hover:bg-ink-surface hover:text-snow" onClick={() => setOpen(false)}>
                    {t(l.key)}
                  </Link>
                ),
              )}
              <a href={LINKS.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg px-2 py-2.5 text-mist hover:bg-ink-surface hover:text-snow" onClick={() => setOpen(false)}>
                <GitHubIcon className="h-4 w-4" /> GitHub
              </a>
              <div className="mt-2 flex items-center justify-between gap-3">
                <LangToggle />
                <Link
                  href={LINKS.submit}
                  className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-snow"
                  onClick={() => setOpen(false)}
                >
                  {t("land.nav.run")}
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

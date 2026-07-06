// SPDX-License-Identifier: Apache-2.0
/** Closing CTA on a primary→accent gradient panel. */
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLang } from "../LangProvider";
import { LINKS } from "./data";
import { Reveal } from "./ui";

export function CTA() {
  const { t } = useLang();

  return (
    <section className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <Reveal>
        {/* Dark panel (surface token) — the blue→violet gradient appears only
            as accents: the hairline ring, the slow sheen and the primary
            button. Hover lift, black-only shadow, reduced-motion safe. */}
        <div className="rounded-3xl bg-gradient-to-br from-accent-blue/40 via-accent-cyan/20 to-accent-violet/40 p-px shadow-lg shadow-black/40 transition-transform duration-200 ease-brand hover:-translate-y-1">
          <div className="relative overflow-hidden rounded-3xl bg-ink-surface px-8 py-12 text-center sm:px-12 sm:py-16">
            <div className="cta-sheen absolute inset-0" aria-hidden="true" />
            <h2 className="relative mx-auto max-w-2xl font-display text-[28px] font-extrabold leading-[1.15] tracking-tight text-snow sm:text-[40px]">
              {t("land.cta.h2")}
            </h2>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={LINKS.submit}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-accent-blue to-accent-violet px-6 py-3 text-base font-semibold text-snow shadow-lg shadow-black/20 transition-all duration-200 ease-brand hover:-translate-y-px hover:shadow-black/40"
            >
              {t("land.nav.run")}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <Link
              href={LINKS.docs}
              className="inline-flex items-center gap-2 rounded-xl border border-snow/40 bg-snow/10 px-6 py-3 text-base font-semibold text-snow transition-colors duration-200 ease-brand hover:bg-snow/20"
            >
              {t("land.cta.docs")}
            </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// SPDX-License-Identifier: Apache-2.0
/** Closing CTA on a blue gradient panel. */
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLang } from "../LangProvider";
import { LINKS } from "./data";
import { Reveal } from "./ui";

export function CTA() {
  const { t } = useLang();

  return (
    <section className="mx-auto max-w-6xl px-5 pb-20 pt-4 sm:pb-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent-blue via-blue-600 to-accent-violet px-8 py-14 text-center shadow-2xl shadow-accent-blue/25 sm:px-12 sm:py-20">
          {/* subtle texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
            aria-hidden="true"
          />
          <h2 className="relative mx-auto max-w-2xl font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            {t("land.cta.h2")}
          </h2>
          <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={LINKS.submit}
              className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-blue-700 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
            >
              {t("land.nav.run")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <Link
              href={LINKS.docs}
              className="inline-flex items-center gap-2 rounded-xl border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white/20"
            >
              {t("land.cta.docs")}
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

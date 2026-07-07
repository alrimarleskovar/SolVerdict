// SPDX-License-Identifier: Apache-2.0
/**
 * Architecture — the real harness components as a left-to-right flow of clean
 * nodes with subtle connectors. Node code labels map 1:1 to the repo
 * (bench.ts, setups/*, env/surfpool, RPC recorder, scoring/*, report JSON).
 */
"use client";

import { ArrowRight } from "lucide-react";
import { useLang } from "../LangProvider";
import { ARCH_NODES } from "./data";
import { Reveal, SectionHeading } from "./ui";

export function Architecture() {
  const { t } = useLang();

  return (
    <section className="border-y border-ink-line bg-ink-surface/40 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading eyebrow={t("land.arch.eyebrow")} title={t("land.arch.h2")} />

        {/* Connectors LEAD each node (i>0) instead of trailing it, so an arrow
            always points INTO the next node — never into empty space at a wrap.
            Vertical stack (down arrows) below lg; horizontal wrap on lg+ where
            the 7 nodes exceed the container and cleanly break into two rows. */}
        <ol className="mt-12 flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:gap-y-6">
          {ARCH_NODES.map((n, i) => (
            <li key={n.t} className="flex flex-col items-stretch lg:flex-row lg:items-stretch">
              {i > 0 && (
                <span
                  className="flex items-center justify-center py-1 text-mist/40 lg:w-8 lg:py-0"
                  aria-hidden="true"
                >
                  <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                </span>
              )}
              <Reveal delay={0.05 * i} className="shrink-0 lg:h-full">
                <div className="flex h-full w-full flex-col rounded-xl border border-ink-line bg-ink-card px-4 py-3 transition-colors duration-200 ease-brand hover:border-mist/20 lg:w-[168px]">
                  <code className="border-0 bg-transparent p-0 font-code text-[13px] text-accent-cyan">{n.code}</code>
                  <span className="mt-1 font-display text-sm font-semibold text-snow">{t(n.t)}</span>
                  <span className="mt-1 text-[13px] leading-snug text-mist">{t(n.d)}</span>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

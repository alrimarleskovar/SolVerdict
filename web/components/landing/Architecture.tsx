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

        <ol className="mt-12 flex flex-wrap items-stretch gap-y-4">
          {ARCH_NODES.map((n, i) => (
            <li key={n.t} className="flex items-center">
              <Reveal delay={0.05 * i} className="h-full">
                <div className="flex h-full w-[168px] flex-col rounded-xl border border-ink-line bg-ink-card px-4 py-3 transition-colors duration-200 ease-brand hover:border-mist/20">
                  <code className="border-0 bg-transparent p-0 font-code text-[13px] text-accent-cyan">{n.code}</code>
                  <span className="mt-1 font-display text-sm font-semibold text-snow">{t(n.t)}</span>
                  <span className="mt-1 text-[13px] leading-snug text-mist">{t(n.d)}</span>
                </div>
              </Reveal>
              {i < ARCH_NODES.length - 1 && (
                <span className="flex w-8 shrink-0 items-center justify-center" aria-hidden="true">
                  <ArrowRight className="h-4 w-4 text-mist/40" />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

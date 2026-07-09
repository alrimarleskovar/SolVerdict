// SPDX-License-Identifier: Apache-2.0
/** Attack-coverage grid — eight areas, each mapped to its REAL scenario ids. */
"use client";

import {
  Ban,
  Crosshair,
  Droplets,
  GitCommitHorizontal,
  KeyRound,
  ListChecks,
  Syringe,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "../LangProvider";
import { GRID_ITEMS } from "./data";
import { Reveal, SectionHeading } from "./ui";

const ICONS: LucideIcon[] = [Syringe, Droplets, Ban, KeyRound, ListChecks, Crosshair, Timer, GitCommitHorizontal];

export function FeaturesGrid() {
  const { t } = useLang();

  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
      <SectionHeading eyebrow={t("land.grid.eyebrow")} title={t("land.grid.h2")} titleMax="max-w-none" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GRID_ITEMS.map((item, i) => {
          const Icon = ICONS[i];
          return (
            <Reveal key={item.t} delay={0.04 * i} className="h-full">
              <div className="flex h-full items-start gap-4 rounded-xl border border-ink-line bg-ink-card/60 p-4 transition-all duration-200 ease-brand hover:-translate-y-1 hover:border-mist/20 hover:bg-ink-card">
                <span className="mt-1 rounded-lg border border-ink-line bg-ink-surface p-2 text-brand-cyan">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-display text-sm font-semibold text-snow">{t(item.t)}</span>
                  <span className="mt-1 block font-code text-[13px] text-mist">{item.scenarios}</span>
                </span>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

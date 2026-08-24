// SPDX-License-Identifier: Apache-2.0
/**
 * "How the audit works" — the section v1 does not have, and the one that makes
 * "product first" mean something more than a rewritten headline. v1 is a
 * research-artifact page end to end: it explains the benchmark's pipeline three
 * separate times and never once tells a visitor what THEY would do.
 *
 * Three steps, all real protocol: run the harness locally, sign the manifest
 * digest and submit the bundle, receive a server-derived verdict. It doubles as
 * the prose form of the boundary the hero panel now draws — and closes with the
 * reason the boundary exists, which is the harness README's own argument: a
 * client that holds the checks holds the answer key.
 *
 * Reuses SakAdapterCallout verbatim from /submit. The hero names Solana Agent
 * Kit, so SAK users are the readers most likely to arrive here — this is the
 * one callout that turns them into a run.
 */
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLang } from "../../LangProvider";
import { CopyCommand } from "../../CopyCommand";
import { SakAdapterCallout } from "../../SakAdapterCallout";
import { LINKS } from "../data";
import { Reveal, SectionHeading } from "../ui";
import { HOW_STEPS } from "./data";

export function HowItWorks() {
  const { t } = useLang();

  return (
    <section id="how" className="scroll-mt-24 border-y border-ink-line bg-ink-surface/40 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading eyebrow={t("land2.how.eyebrow")} title={t("land2.how.h2")} titleMax="max-w-none" />

        {/* A numbered VERTICAL list, not a 3-up card grid. Two reasons, and the
            first is the weaker one: three side-by-side cards read as three
            features, while this is one ordered procedure. The second is
            measured — at a third of the container the shared CopyCommand's
            break-all split `--agent` into `--age / nt`, and a command that
            looks mistyped is worse than no command. Full-width rows give every
            line room to sit unbroken. */}
        <ol className="mt-12 grid gap-4">
          {HOW_STEPS.map((s, i) => (
            <li key={s.t}>
              <Reveal delay={0.08 * i} className="rounded-2xl border border-ink-line bg-ink-card/60 p-6 shadow-lg shadow-black/20">
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr] sm:items-baseline">
                  <span className="font-code text-[13px] uppercase tracking-[0.18em] text-brand-cyan sm:pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold tracking-tight text-snow">{t(s.t)}</h3>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">{t(s.b)}</p>
                    {s.code && (
                      <div className="mt-4">
                        {/* step 2's line is harness OUTPUT, not a command to
                            run — so no `$` prompt in front of it */}
                        <CopyCommand command={s.code} prompt={i === 0} />
                      </div>
                    )}
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        {/* items-start: the aside is much shorter than the SAK callout, and
            stretching it just opened a dead field of empty card. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <Reveal delay={0.24}>
            <SakAdapterCallout />
          </Reveal>

          <Reveal delay={0.3}>
            <aside className="rounded-2xl border border-brand-purple/25 bg-brand-purple/[0.06] p-6">
              <p className="text-sm leading-relaxed text-mist">{t("land2.how.why")}</p>
              <Link
                href={LINKS.docs}
                className="group inline-flex items-center gap-2 pt-6 font-code text-[13px] text-snow transition-colors duration-200 ease-brand hover:text-brand-cyan"
              >
                {t("land.nav.docs")}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </aside>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

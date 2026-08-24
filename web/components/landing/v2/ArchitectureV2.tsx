// SPDX-License-Identifier: Apache-2.0
/**
 * Architecture, v2 — three phases across the trust boundary, replacing v1's
 * seven-node component list.
 *
 * WHY IT IS A FORK AND NOT AN EDIT. It was written while landing/Architecture
 * was still the mounted one and had to keep working. That page has since been
 * promoted away from it; the original is unreferenced and slated for deletion,
 * at which point this can lose the V2 and absorb the header below.
 *
 * WHY IT DESCRIBES A DIFFERENT PIPELINE. v1's nodes are the OFFICIAL campaign:
 * `bench.ts` orchestrating four setups, ending in "versioned, published,
 * citable results files". A visitor buying an audit runs none of that — their
 * path is `solverdict-run` → packages/harness/src/runner.ts, which that file's
 * own header describes as "bench.ts's loop with the scoring removed". Three of
 * the seven nodes were therefore describing a pipeline the reader will never
 * execute, and one of them was actively contradicting the product:
 *
 *   n5, "Scoring engine — deterministic check() + three-outcome intent
 *   classifier", sat inline in a single unbroken left-to-right flow, which
 *   reads as running wherever n1-n4 run. On the customer path it does not, and
 *   cannot: check(), classifyOutcome() and scoreSetup() are absent from the
 *   shipped harness precisely because a client that can compute the verdict can
 *   forge it. That is the same quiet contradiction the hero panel was split to
 *   fix, reappearing four sections further down.
 *
 * SO THE GROUPING IS BY LOCATION, NOT BY PHASE. Run and Capture are yours;
 * Score is ours; the seam between them is the strongest edge in the section and
 * carries the same caption as the hero panel's (`land2.dash.*`), so the two
 * drawings rhyme instead of repeating. The hero panel shows one run in flight;
 * this answers a different question — why the evidence is worth believing —
 * which is why the section stays rather than being deleted as a third pipeline.
 *
 * WHAT THE SHARED LOOP BUYS: the lead line. The customer path is credible
 * because it is the SAME evidence loop as the published campaign with only the
 * scoring moved, which is a selling point rather than an implementation note.
 *
 * The seven nodes still exist and are still accurate about the repo, so the
 * link goes to the protocol doc rather than the detail being dropped.
 */
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLang } from "../../LangProvider";
import { LINKS } from "../data";
import { Reveal, SectionHeading } from "../ui";
import type { TKey } from "../../../lib/i18n";

type Node = { phase: TKey; t: TKey; d: TKey; code: string };

/** Each `code` is the real module a reader would open in the repo. */
const CLIENT_NODES: Node[] = [
  { phase: "land2.arch.p1", t: "land2.arch.n1.t", d: "land2.arch.n1.d", code: "solverdict-run" },
  { phase: "land2.arch.p2", t: "land2.arch.n2.t", d: "land2.arch.n2.d", code: "env/recorder.ts" },
];
const SERVER_NODE: Node = {
  phase: "land2.arch.p3",
  t: "land2.arch.n3.t",
  d: "land2.arch.n3.d",
  code: "scoring/rescore.ts",
};

function PhaseCard({ n, tone }: { n: Node; tone: "client" | "server" }) {
  const { t } = useLang();
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border p-5 sm:p-6 ${
        tone === "server"
          ? "border-brand-purple/25 bg-brand-purple/[0.06]"
          : "border-ink-line bg-ink-card/60"
      }`}
    >
      <span
        className={`font-code text-[12px] uppercase tracking-[0.2em] ${
          tone === "server" ? "text-brand-purple" : "text-brand-cyan"
        }`}
      >
        {t(n.phase)}
      </span>
      <span className="mt-3 font-display text-lg font-semibold leading-snug text-snow">{t(n.t)}</span>
      <span className="mt-2 text-[14px] leading-relaxed text-mist">{t(n.d)}</span>
      {/* Pushed to the bottom edge so the code hints line up across cards of
          unequal copy length. */}
      <code className="mt-auto block border-0 bg-transparent p-0 pt-5 font-code text-[12px] text-mist/60">
        {n.code}
      </code>
    </div>
  );
}

export function ArchitectureV2() {
  const { t } = useLang();

  return (
    <section className="border-y border-ink-line bg-ink-surface/40 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        {/* max-w-4xl, not max-w-none: at full container width the EN heading
            breaks inside "self-reported" at its own hyphen. Wrapping it earlier
            puts the break at the em dash instead. */}
        <SectionHeading eyebrow={t("land.arch.eyebrow")} title={t("land.arch.h2")} titleMax="max-w-4xl text-balance" />

        <Reveal delay={0.06}>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-mist">{t("land2.arch.lead")}</p>
        </Reveal>

        {/* THE BOUNDARY IS THE LAYOUT. Two client cards and one server card,
            split by a seam that is the heaviest edge here: a dashed vertical
            rule on lg (the hero panel's is horizontal, so the device reads as
            the same idea rather than the same picture) and a dashed horizontal
            one below it. Zone labels sit above their own group so neither card
            has to state where it runs. */}
        <div className="mt-10 grid items-stretch gap-8 lg:grid-cols-[1.6fr_auto_1fr] lg:gap-0">
          {/* flex-col + flex-1 on both columns, so the two client cards and the
              single server card resolve to one height. Without it the server
              card stretches to the row while the client grid keeps its natural
              height, and the three bottom edges disagree by ~30px. */}
          <div className="flex flex-col">
            <Reveal delay={0.1}>
              <p className="mb-3 font-code text-[12px] uppercase tracking-[0.2em] text-mist/70">
                {t("land2.dash.zone.client")}
              </p>
            </Reveal>
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              {CLIENT_NODES.map((n, i) => (
                <Reveal key={n.t} delay={0.14 + 0.06 * i} className="h-full">
                  <PhaseCard n={n} tone="client" />
                </Reveal>
              ))}
            </div>
          </div>

          {/* The seam, drawn as two rule segments with the caption BETWEEN them
              rather than knocked out over a single rule: this section's ground
              is ink-surface at 40% over ink, so an opaque knockout swatch is a
              visibly lighter rectangle sitting on the line. Vertical on lg with
              the caption rotated into it (-90° also turns the ↓ glyph to point
              along the flow, into the server zone); horizontal below, where a
              rotated caption would be unreadable and the flow is downward. */}
          <div className="flex items-center justify-center gap-3 lg:mx-8 lg:w-px lg:flex-col" aria-hidden="true">
            <span className="h-0 flex-1 border-t-2 border-dashed border-brand-purple/45 lg:h-auto lg:w-0 lg:border-l-2 lg:border-t-0" />
            <span className="shrink-0 whitespace-nowrap font-code text-[11px] uppercase tracking-[0.18em] text-brand-purple lg:-rotate-90">
              ↓ {t("land2.dash.boundary")}
            </span>
            <span className="h-0 flex-1 border-t-2 border-dashed border-brand-purple/45 lg:h-auto lg:w-0 lg:border-l-2 lg:border-t-0" />
          </div>

          <div className="flex flex-col">
            <Reveal delay={0.2}>
              <p className="mb-3 font-code text-[12px] uppercase tracking-[0.2em] text-brand-purple/80">
                {t("land2.dash.zone.server")}
              </p>
            </Reveal>
            <Reveal delay={0.26} className="flex-1">
              <PhaseCard n={SERVER_NODE} tone="server" />
            </Reveal>
          </div>
        </div>

        {/* The claim the section exists to make, and the way out to the detail
            for the reader who was going to the repo anyway. */}
        <Reveal delay={0.32}>
          <div className="mt-10 flex flex-col gap-4 border-t border-ink-line pt-6 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
            <p className="max-w-2xl text-[14px] leading-relaxed text-mist">{t("land2.arch.why")}</p>
            <Link
              href={LINKS.docs}
              className="group inline-flex shrink-0 items-center gap-2 font-code text-[13px] text-snow transition-colors duration-200 ease-brand hover:text-brand-cyan"
            >
              {t("land2.arch.more")}
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 ease-brand group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

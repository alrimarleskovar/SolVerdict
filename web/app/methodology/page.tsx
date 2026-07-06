// SPDX-License-Identifier: Apache-2.0
/**
 * /methodology — the Benchmark vs Audit vs Leaderboard separation, rendered
 * in-site with the landing design system (ink palette, SectionHeading, Reveal).
 * Content is a faithful transcription of docs/METHODOLOGY.md; the canonical
 * sources (pre-registration, threat model, conflict-of-interest policy) are
 * linked at the bottom. Same server-component + cookie-language pattern as
 * /pricing.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { InnerPageShell } from "../../components/InnerPageShell";
import { Reveal, SectionHeading } from "../../components/landing/ui";
import { LINKS } from "../../components/landing/data";
import { LANG_COOKIE, parseLang, t as translate, type TKey } from "../../lib/i18n";

export const metadata: Metadata = {
  title: "SolVerdict — methodology",
  description:
    "How the pre-registered benchmark, the paid Audit product, and the opt-in Leaderboard stay separate — one scoring engine, different guarantees.",
};

/** One "surface" card: title, faithful description, and its Can / Cannot wall. */
function SurfaceCard({
  title,
  paragraphs,
  can,
  cannot,
  canLabel,
  cannotLabel,
  delay,
}: {
  title: string;
  paragraphs: string[];
  can: string;
  cannot: string;
  canLabel: string;
  cannotLabel: string;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <article className="rounded-2xl border border-ink-line bg-ink-card/60 p-6 shadow-lg shadow-black/20 sm:p-8">
        <h2 className="font-display text-lg font-bold tracking-tight text-snow">{title}</h2>
        {paragraphs.map((p) => (
          <p key={p.slice(0, 32)} className="mt-3 text-sm leading-relaxed text-mist">
            {p}
          </p>
        ))}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-state-ok/40 bg-state-ok/10 p-4">
            <p className="font-code text-[13px] uppercase tracking-[0.1em] text-state-ok">{canLabel}</p>
            <p className="mt-2 text-sm leading-relaxed text-mist">{can}</p>
          </div>
          <div className="rounded-xl border border-state-bad/40 bg-state-bad/10 p-4">
            <p className="font-code text-[13px] uppercase tracking-[0.1em] text-state-bad">{cannotLabel}</p>
            <p className="mt-2 text-sm leading-relaxed text-mist">{cannot}</p>
          </div>
        </div>
      </article>
    </Reveal>
  );
}

export default function MethodologyPage() {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  const t = (k: TKey) => translate(lang, k);

  const surfaces: Array<{ key: "bench" | "audit" | "lb"; paragraphs: TKey[] }> = [
    { key: "bench", paragraphs: ["meth.bench.p1", "meth.bench.p2"] },
    { key: "audit", paragraphs: ["meth.audit.p1"] },
    { key: "lb", paragraphs: ["meth.lb.p1"] },
  ];

  const refs: Array<{ label: TKey; file: string; href: string }> = [
    { label: "meth.refs.prereg", file: "tripwire-prereg-v0.2.2.md", href: LINKS.prereg },
    { label: "meth.refs.threat", file: "docs/THREAT_MODEL.md", href: LINKS.threatModel },
    { label: "meth.refs.coi", file: "docs/CONFLICT_OF_INTEREST.md", href: LINKS.coi },
  ];

  return (
    <InnerPageShell>
      <section className="pb-8 pt-8">
        <SectionHeading as="h1" eyebrow={t("meth.eyebrow")} title={t("meth.h1")} titleMax="max-w-none" />
        <Reveal delay={0.1}>
          <p className="mt-6 text-base leading-relaxed text-mist">{t("meth.intro")}</p>
        </Reveal>
      </section>

      <section className="space-y-6 py-8" aria-label={t("meth.h1")}>
        {surfaces.map((s, i) => (
          <SurfaceCard
            key={s.key}
            delay={0.05 * i}
            title={t(`meth.${s.key}.t` as TKey)}
            paragraphs={s.paragraphs.map((p) => t(p))}
            can={t(`meth.${s.key}.can` as TKey)}
            cannot={t(`meth.${s.key}.cannot` as TKey)}
            canLabel={t("meth.can")}
            cannotLabel={t("meth.cannot")}
          />
        ))}
      </section>

      <section className="py-8">
        <SectionHeading eyebrow={t("meth.eyebrow")} title={t("meth.why.t")} titleMax="max-w-none" />
        <Reveal delay={0.1}>
          <p className="mt-6 text-base leading-relaxed text-mist">{t("meth.why.p1")}</p>
        </Reveal>
      </section>

      <section className="py-8">
        <Reveal>
          <h2 className="font-display text-lg font-bold tracking-tight text-snow">{t("meth.refs.t")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-mist">{t("meth.refs.d")}</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="mt-6 flex flex-wrap gap-3">
            {refs.map((r) => (
              <a
                key={r.href}
                href={r.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-ink-line bg-ink/60 px-4 py-3 text-sm font-medium text-snow transition-colors duration-200 ease-brand hover:border-mist/40"
              >
                {t(r.label)}
                <code className="rounded-lg border border-ink-line px-2 py-1 font-code text-[13px] text-mist">{r.file}</code>
              </a>
            ))}
          </div>
        </Reveal>
      </section>
    </InnerPageShell>
  );
}

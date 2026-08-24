// SPDX-License-Identifier: Apache-2.0
/**
 * Landing page — the product-first composition promoted from /landing-v2.
 *
 * THE INVERSION. The previous landing led with "The benchmark for secure
 * Solana AI agents" — it sold the benchmark, which is the moat and not the
 * pitch. This leads with the finding the benchmark produced, turns it into the
 * reader's own open question, and puts the benchmark underneath as proof:
 *
 *   1. HeroV2        — the promise, the finding, one primary action.
 *   2. Stats         — the size of the evidence base.
 *   3. FeaturesGrid  — what the 20 scenarios actually cover. Directly under
 *                      Stats because Stats asserts "20 adversarial scenarios,
 *                      6 attack categories" as bare numbers and this is the
 *                      only place that names them.
 *   4. LeaderboardV2 — #results, the benchmark itself, as proof not pitch.
 *   5. Demo          — the same proof at run level: the verbatim payloads and
 *                      verdicts behind the sak+claude row just read on the
 *                      board. FindingCaveat trails it with the association
 *                      caveat, which qualifies exactly these two examples.
 *   6. HowItWorks    — what the visitor actually does.
 *   7. ArchitectureV2 — why the evidence is worth believing.
 *   8. OpenSource / CTA / Footer.
 *
 * The proof runs at positions 2-5, immediately under the fold, because the
 * hero's claim is only worth as much as how fast a sceptic can reach the
 * numbers behind it.
 *
 * REVERTING. The previous components are still in the repo, unreferenced:
 * landing/Hero, FeatureCards, BenchmarkFlow, Architecture and Leaderboard.
 * Swapping back is this import list and this section order:
 *
 *   Hero → Stats → FeatureCards → BenchmarkFlow → Demo → Architecture →
 *   Leaderboard → FeaturesGrid → OpenSource → CTA → Footer
 *
 * with <Navbar /> taking no props, no LangProvider/LangFromQuery/Intro, and no
 * searchParams. Everything else on this page (Stats, Demo, FeaturesGrid,
 * OpenSource, CTA, Footer, Navbar, Background, ParticleField) is shared and
 * unchanged by the promotion.
 *
 * INDEXING. /landing-v2 carried robots: { index: false } because two landings
 * competing for the same terms is a real SEO problem and it was a proposal, not
 * a publication. That is deliberately absent here — this page is meant to be
 * indexed, and adding a robots key back would silently un-list the homepage.
 *
 * Every result shown on this page is real official v0.3.0 data — see
 * components/landing/data.ts for the canonical citations.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LangProvider } from "../components/LangProvider";
import { Navbar } from "../components/landing/Navbar";
import { HeroBackground } from "../components/landing/Background";
import { ParticleField } from "../components/landing/ParticleField";
import { FindingCaveat } from "../components/landing/v2/FindingCaveat";
import { HeroV2 } from "../components/landing/v2/HeroV2";
import { HowItWorks } from "../components/landing/v2/HowItWorks";
import { Intro } from "../components/landing/v2/Intro";
import { INTRO_COOKIE } from "../components/landing/v2/intro-data";
import { LangFromQuery } from "../components/landing/v2/LangFromQuery";
import { LeaderboardV2 } from "../components/landing/v2/LeaderboardV2";
import { ArchitectureV2 } from "../components/landing/v2/ArchitectureV2";
import { Demo } from "../components/landing/Demo";
import { Stats } from "../components/landing/Stats";
import { FeaturesGrid } from "../components/landing/FeaturesGrid";
import { OpenSource } from "../components/landing/OpenSource";
import { CTA } from "../components/landing/CTA";
import { Footer } from "../components/landing/Footer";
import { LANG_COOKIE, parseLang, type Lang } from "../lib/i18n";

/**
 * Written here rather than reused from BRANDING.description, which is the
 * benchmark-first line ("Open, reproducible safety benchmark for AI agents…")
 * and is the canonical string for the RENDERED REPORT surfaces — the wrong
 * sentence to put under a product-first H1, and not ours to repoint. This is
 * the search snippet, so it says what the reader does here.
 */
const TITLE = "SolVerdict — audit your Solana agent before it moves real money";
const DESCRIPTION =
  "Run adversarial safety tests on your Solana AI agent locally, submit verifiable evidence, " +
  "and get a pre-registered containment verdict scored server-side from the raw evidence.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    // Repeated here because a page-level openGraph replaces the layout's, so
    // the root layout's og-image would otherwise be dropped on the homepage.
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "SolVerdict — AI Agent Security Benchmark" }],
  },
};

export default function Home({
  searchParams,
}: {
  searchParams?: { lang?: string | string[]; intro?: string | string[] };
}) {
  const jar = cookies();
  const cookieLang = parseLang(jar.get(LANG_COOKIE)?.value);

  // Decided on the server so a returning visitor never sees the overlay at all
  // — not for a frame. `?intro=1` forces it back for a demo; `?intro=0`
  // suppresses it, which is the link to send when the page itself is the point
  // and a 9.75s title sequence is not.
  const introSeen = jar.get(INTRO_COOKIE)?.value === "1";
  const introParam = typeof searchParams?.intro === "string" ? searchParams.intro : null;
  const playIntro = introParam === "0" ? false : introParam === "1" || !introSeen;

  // Only an explicit, valid value overrides the cookie — parseLang() coerces
  // anything unrecognised to "en", which would let `?lang=xyz` silently force a
  // PT reader back into English.
  const raw = typeof searchParams?.lang === "string" ? searchParams.lang : null;
  const requested: Lang | null = raw === "pt" ? "pt" : raw === "en" ? "en" : null;
  const lang = requested ?? cookieLang;

  return (
    <div className="landing full-bleed relative min-h-screen bg-ink font-body text-snow antialiased">
      {/* Cover the site-wide fixed Solana-gradient top bar (body::before, z-5)
          while the landing is mounted — its purple/green clashes with the
          landing palette. Inner pages keep the bar. */}
      <div className="fixed inset-x-0 top-0 z-10 h-[3px] bg-ink" aria-hidden="true" />

      {/* Reconciles cookie, <html lang> and the URL with what the server just
          rendered. No re-render involved — see the component. */}
      {requested && <LangFromQuery lang={requested} />}

      {/* Nested inside the root layout's provider ON PURPOSE: the layout reads
          the cookie only, so without this `?lang=pt` would render English until
          a reload. Nothing links to `?lang=`, so it creates no crawlable
          duplicate of this page. */}
      <LangProvider initialLang={lang}>
        {/* Painted OVER a finished page, never in place of one — everything
            below is rendered and interactive while it plays. */}
        {playIntro && <Intro />}
        <ParticleField />
        <HeroBackground />
        {/* No alwaysShowCheck: the mark keeps its hover reveal here like
            everywhere else, and the opening sequence hands the drawn check to
            it for a beat at the morph instead of the page holding it on
            forever. See THE HANDOFF in LockupLogo. */}
        <Navbar ctaKey="land2.hero.cta" benchmarkHref="#results" />
        <main className="relative">
          <HeroV2 />
          <Stats />
          <FeaturesGrid />
          <LeaderboardV2 />
          <Demo />
          <FindingCaveat />
          <HowItWorks />
          <ArchitectureV2 />
          <OpenSource />
          <CTA />
        </main>
        <Footer />
      </LangProvider>
    </div>
  );
}

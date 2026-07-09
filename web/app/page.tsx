// SPDX-License-Identifier: Apache-2.0
/**
 * Landing page — premium research-platform redesign (components/landing/*).
 *
 * Server component: loads the landing type system (Inter Tight display /
 * Inter body / JetBrains Mono code via next/font, self-hosted at build time)
 * and composes the client sections. The `.landing full-bleed` wrapper escapes
 * the root layout's 880px .wrap and carries its own near-black palette;
 * inner pages (/submit, /pricing, …) keep the existing Solana identity.
 *
 * Every result shown on this page is real v0.2.2 Run B data — see
 * components/landing/data.ts for the canonical citations.
 */
import type { Metadata } from "next";
import { BRANDING } from "../../config/branding";
import { Navbar } from "../components/landing/Navbar";
import { HeroBackground } from "../components/landing/Background";
import { ParticleField } from "../components/landing/ParticleField";
import { Hero } from "../components/landing/Hero";
import { Stats } from "../components/landing/Stats";
import { FeatureCards } from "../components/landing/FeatureCards";
import { BenchmarkFlow } from "../components/landing/BenchmarkFlow";
import { Demo } from "../components/landing/Demo";
import { Architecture } from "../components/landing/Architecture";
import { Leaderboard } from "../components/landing/Leaderboard";
import { FeaturesGrid } from "../components/landing/FeaturesGrid";
import { OpenSource } from "../components/landing/OpenSource";
import { CTA } from "../components/landing/CTA";
import { Footer } from "../components/landing/Footer";

export const metadata: Metadata = {
  title: "SolVerdict — the benchmark for secure Solana AI agents",
  description: BRANDING.description,
  openGraph: {
    title: "SolVerdict — the benchmark for secure Solana AI agents",
    description: BRANDING.description,
    type: "website",
    // Repeated here because a page-level openGraph replaces the layout's, so
    // the root layout's og-image would otherwise be dropped on the homepage.
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "SolVerdict — AI Agent Security Benchmark" }],
  },
};

export default function Home() {
  return (
    <div className="landing full-bleed relative min-h-screen bg-ink font-body text-snow antialiased">
      {/* Cover the site-wide fixed Solana-gradient top bar (body::before, z-5)
          while the landing is mounted — its purple/green clashes with the
          landing palette. Inner pages keep the bar. */}
      <div className="fixed inset-x-0 top-0 z-10 h-[3px] bg-ink" aria-hidden="true" />
      <ParticleField />
      <HeroBackground />
      <Navbar />
      <main className="relative">
        <Hero />
        <Stats />
        <FeatureCards />
        <BenchmarkFlow />
        <Demo />
        <Architecture />
        <Leaderboard />
        <FeaturesGrid />
        <OpenSource />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

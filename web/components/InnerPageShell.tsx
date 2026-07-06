// SPDX-License-Identifier: Apache-2.0
/**
 * Shared chrome for every inner page (/submit, /pricing, /docs/protocol,
 * /leaderboard, /dashboard, /audit/[id]): the SAME navbar, footer, ink
 * background and type system as the landing page.
 *
 * It reuses the `.landing full-bleed` design-system scope from globals.css —
 * inside it the legacy component classes (.glass, .btn, .field, table.placard,
 * tier colors) and the brand CSS variables are re-themed to the ink palette,
 * so the pages' existing markup and logic render in the new visual system
 * WITHOUT structural changes.
 *
 * Client component (Navbar needs wallet/scroll state); server pages pass
 * their content through as children.
 */
"use client";

import type { ReactNode } from "react";
import { Navbar } from "./landing/Navbar";
import { Footer } from "./landing/Footer";
import { BackLink } from "./Brand";

export function InnerPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing full-bleed relative flex min-h-screen flex-col bg-ink font-body text-snow antialiased">
      {/* Cover the site-wide fixed Solana-gradient top bar (body::before, z-5)
          so all pages share the landing's clean top edge. */}
      <div className="fixed inset-x-0 top-0 z-10 h-[3px] bg-ink" aria-hidden="true" />
      <Navbar showWallet />
      <main className="relative mx-auto w-full max-w-5xl flex-1 px-5 pb-24 pt-8">
        <BackLink />
        {children}
      </main>
      <Footer />
    </div>
  );
}

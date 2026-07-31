// SPDX-License-Identifier: Apache-2.0
/**
 * Benchmark Explorer chrome: sticky header with breadcrumbs + gradient
 * hairline, wide content column. GitHub-Actions-meets-Stripe: dense, dark,
 * monospace accents.
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export function ExplorerShell({
  crumbs,
  actions,
  children,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="h-[2px] w-full bg-gradient-to-r from-sol-purple via-sol-green to-sol-purple opacity-80" />
        <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
            <Link
              href="/explorer"
              className="shrink-0 font-semibold text-text-strong transition-colors hover:text-purple-soft"
            >
              Benchmark Explorer
            </Link>
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                {c.href ? (
                  <Link href={c.href} className="truncate font-mono text-[13px] text-text transition-colors hover:text-purple-soft">
                    {c.label}
                  </Link>
                ) : (
                  <span className="truncate font-mono text-[13px] text-text-strong">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <motion.main
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"
      >
        {children}
      </motion.main>
    </div>
  );
}

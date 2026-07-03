// SPDX-License-Identifier: Apache-2.0
"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { BRANDING } from "../../config/branding";

// Wallet button is browser-only — load it client-side to avoid SSR/hydration issues.
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <span className="btn" aria-hidden="true">Connect Wallet</span> },
);

/** The SolVerdict verdict glyph — check (green) + cross (red), matching docs/. */
export function Logo({ className = "logo" }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="SolVerdict verdict glyph"
    >
      <path d="M3 13l4 4 6-9" stroke="#14F195" />
      <path d="M14 8l6 8M20 8l-6 8" stroke="#e0635e" />
    </svg>
  );
}

/** Wordmark: glyph + gradient "SolVerdict". */
export function Wordmark() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontFamily: "var(--mono)", fontWeight: 700 }}>
      <Logo />
      <span className="sol">SolVerdict</span>
    </span>
  );
}

/** Top navigation bar shared across pages. */
export function TopBar() {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "1.1rem 0 0.4rem",
        flexWrap: "wrap",
      }}
    >
      <Link href="/" style={{ textDecoration: "none" }}>
        <Wordmark />
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", fontFamily: "var(--mono)", fontSize: "0.9rem" }}>
        <Link href="/pricing">Pricing</Link>
        <Link href="/docs/protocol">Docs</Link>
        <a href={BRANDING.repoUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <WalletMultiButton />
      </div>
    </nav>
  );
}

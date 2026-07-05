// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { BRANDING } from "../../config/branding";
import { useLang } from "./LangProvider";

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

/** EN | PT language switch (persists to the solverdict_lang cookie). */
function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <span className="lang-toggle" role="group" aria-label="Language">
      <button type="button" className={lang === "en" ? "lang-active" : ""} onClick={() => setLang("en")} aria-pressed={lang === "en"}>
        EN
      </button>
      <span aria-hidden="true">|</span>
      <button type="button" className={lang === "pt" ? "lang-active" : ""} onClick={() => setLang("pt")} aria-pressed={lang === "pt"}>
        PT
      </button>
    </span>
  );
}

/** Top navigation bar shared across pages. Collapses to a hamburger ≤640px. */
export function TopBar() {
  const { t } = useLang();
  const { connected } = useWallet();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand" style={{ textDecoration: "none" }} onClick={close}>
        <Wordmark />
      </Link>

      <button
        type="button"
        className="nav-toggle btn"
        aria-label={t("nav.menu")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "✕" : "☰"}
      </button>

      <div className={`nav-links${open ? " open" : ""}`}>
        <Link href="/pricing" onClick={close}>
          {t("nav.pricing")}
        </Link>
        <Link href="/docs/protocol" onClick={close}>
          {t("nav.docs")}
        </Link>
        <Link href="/leaderboard" onClick={close}>
          {t("nav.leaderboard")}
        </Link>
        {connected && (
          <Link href="/dashboard" onClick={close}>
            {t("nav.dashboard")}
          </Link>
        )}
        <a href={BRANDING.repoUrl} target="_blank" rel="noreferrer">
          {t("nav.github")}
        </a>
        <LangToggle />
        <WalletMultiButton />
      </div>
    </nav>
  );
}

/** "← Back to home" link, placed top-left below the nav on inner pages. */
export function BackLink() {
  const { t } = useLang();
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <Link href="/" className="back-link">
        {t("back.home")}
      </Link>
    </div>
  );
}

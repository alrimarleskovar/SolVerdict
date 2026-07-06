// SPDX-License-Identifier: Apache-2.0
"use client";

/**
 * Site-wide brand exports — unified on the SolVerdict shield mark
 * (components/landing/Logo.tsx). The old check/cross verdict glyph and the old
 * TopBar are retired: every page now renders the landing Navbar/Footer via
 * components/InnerPageShell.tsx (or the landing itself).
 */
import Link from "next/link";
import { useLang } from "./LangProvider";
import { SolVerdictLogo, SolVerdictWordmark } from "./landing/Logo";

/** The SolVerdict mark (shield + Solana layers + verification check). */
export function Logo({ className = "logo" }: { className?: string }) {
  return <SolVerdictLogo className={className} size={22} />;
}

/** Wordmark: mark + name. */
export function Wordmark() {
  return <SolVerdictWordmark size={22} />;
}

/** "← Back to home" link, placed top-left below the nav on inner pages. */
export function BackLink() {
  const { t } = useLang();
  return (
    <div style={{ margin: "0 0 1.5rem" }}>
      <Link href="/" className="back-link">
        {t("back.home")}
      </Link>
    </div>
  );
}

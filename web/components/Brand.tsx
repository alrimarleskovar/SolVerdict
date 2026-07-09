// SPDX-License-Identifier: Apache-2.0
"use client";

/**
 * Site-wide brand exports. The logo lives in components/landing/LockupLogo.tsx
 * (SymbolLogo / LockupLogo); this file only carries navigation chrome. Every
 * page renders the landing Navbar/Footer via components/InnerPageShell.tsx
 * (or the landing itself).
 */
import Link from "next/link";
import { useLang } from "./LangProvider";

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

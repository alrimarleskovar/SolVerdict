// SPDX-License-Identifier: Apache-2.0
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, Inter_Tight, JetBrains_Mono, Exo } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { LangProvider } from "../components/LangProvider";
import { LANG_COOKIE, parseLang } from "../lib/i18n";

// Site-wide type system (self-hosted at build time). The variables feed the
// .landing design-system scope used by the landing page and InnerPageShell.
const fontBody = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const fontDisplay = Inter_Tight({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const fontCode = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });
// Brand type: Exo (400/500) powers the SolVerdict lockup wordmark + tagline.
// Exposed as --font-exo so the inline lockup SVG can render its <text> in Exo
// (a raw /*.svg <img> can't load the @import'd webfont — see LockupLogo.tsx).
const fontBrand = Exo({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-exo", display: "swap" });

export const metadata: Metadata = {
  // Anchor for resolving relative OG/Twitter image URLs to absolute ones (Next
  // otherwise falls back to localhost and warns). Matches the audit-PDF host.
  metadataBase: new URL("https://solverdict.vercel.app"),
  title: "SolVerdict — audit your Solana agent's safety",
  description:
    "Submit your Solana agent and get an objective, pre-registered safety verdict: does it contain a dangerous wallet action, or execute it?",
  openGraph: {
    title: "SolVerdict — audit your Solana agent's safety",
    description:
      "Submit your Solana agent and get an objective, pre-registered safety verdict: does it contain a dangerous wallet action, or execute it?",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "SolVerdict — AI Agent Security Benchmark" }],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
};

// themeColor lives in the viewport export (Next 14+ moved it out of metadata;
// keeping it here avoids the deprecation warning). Matches the site background
// (#050816, ink DEFAULT) so the mobile browser chrome blends seamlessly rather
// than showing a seam against the darker brand surface.
export const viewport: Viewport = {
  themeColor: "#050816",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  return (
    <html lang={lang}>
      <body className={`${fontBody.variable} ${fontDisplay.variable} ${fontCode.variable} ${fontBrand.variable}`}>
        <div className="mesh" aria-hidden="true" />
        <Providers>
          <LangProvider initialLang={lang}>
            <div className="wrap">{children}</div>
          </LangProvider>
        </Providers>
      </body>
    </html>
  );
}

// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { LangProvider } from "../components/LangProvider";
import { LANG_COOKIE, parseLang } from "../lib/i18n";

// Site-wide type system (self-hosted at build time). The variables feed the
// .landing design-system scope used by the landing page and InnerPageShell.
const fontBody = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const fontDisplay = Inter_Tight({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const fontCode = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "SolVerdict — audit your Solana agent's safety",
  description:
    "Submit your Solana agent and get an objective, pre-registered safety verdict: does it contain a dangerous wallet action, or execute it?",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  return (
    <html lang={lang}>
      <body className={`${fontBody.variable} ${fontDisplay.variable} ${fontCode.variable}`}>
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

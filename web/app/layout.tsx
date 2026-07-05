// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { LangProvider } from "../components/LangProvider";
import { LANG_COOKIE, parseLang } from "../lib/i18n";

export const metadata: Metadata = {
  title: "SolVerdict — audit your Solana agent's safety",
  description:
    "Submit your Solana agent and get an objective, pre-registered safety verdict: does it contain a dangerous wallet action, or execute it?",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  return (
    <html lang={lang}>
      <body>
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

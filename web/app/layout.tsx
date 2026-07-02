// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolVerdict — audit your Solana agent's safety",
  description:
    "Submit your Solana agent and get an objective, pre-registered safety verdict: does it contain a dangerous wallet action, or execute it?",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mesh" aria-hidden="true" />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}

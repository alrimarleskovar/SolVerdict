// SPDX-License-Identifier: Apache-2.0
/**
 * "Using Solana Agent Kit?" callout — the official @solverdict/sak-adapter
 * replaces hand-implementing the audit protocol for SAK agents.
 * `SakAdapterCallout` renders on /submit (the main conversion point);
 * /docs/protocol reuses `InstallCommand` inside its own doc card. Ink-card
 * styling matches the docs cards so it reads native to the shell.
 */
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLang } from "./LangProvider";
import {
  SAK_ADAPTER_INSTALL,
  SAK_ADAPTER_NPM_URL,
  SAK_ADAPTER_QUICKSTART,
  SAK_ADAPTER_README_URL,
} from "../lib/sak-adapter";

const linkCls = "font-code text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow";

/** The install one-liner with copy-to-clipboard and transient feedback. */
export function InstallCommand() {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-line bg-ink px-4 py-3">
      <code className="block border-0 bg-transparent p-0 font-code text-[13px] text-snow/80">
        $ {SAK_ADAPTER_INSTALL}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(SAK_ADAPTER_INSTALL);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable (http, permissions) — no-op */
          }
        }}
        className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${linkCls}`}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? t("sakad.copied") : t("sakad.copy")}
      </button>
    </div>
  );
}

/** External links to the package (npm) and its README. */
export function AdapterLinks() {
  const { t } = useLang();
  return (
    <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
      <a href={SAK_ADAPTER_NPM_URL} target="_blank" rel="noreferrer" className={linkCls}>
        {t("sakad.npm")} ↗
      </a>
      <a href={SAK_ADAPTER_README_URL} target="_blank" rel="noreferrer" className={linkCls}>
        {t("sakad.readme")} ↗
      </a>
    </p>
  );
}

export function SakAdapterCallout() {
  const { t } = useLang();
  return (
    <aside className="rounded-2xl border border-ink-line bg-ink-card/60 p-6 shadow-lg shadow-black/20">
      <h2 className="font-display text-base font-bold tracking-tight text-snow">{t("sakad.title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-mist">{t("sakad.lead")}</p>
      <div className="mt-4 grid gap-3">
        <InstallCommand />
        <pre className="whitespace-pre-wrap break-words rounded-xl border border-ink-line bg-ink p-4 font-code text-[13px] leading-relaxed text-snow/80">
          <code className="block border-0 bg-transparent p-0">{SAK_ADAPTER_QUICKSTART}</code>
        </pre>
      </div>
      <AdapterLinks />
    </aside>
  );
}

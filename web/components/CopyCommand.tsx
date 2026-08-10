// SPDX-License-Identifier: Apache-2.0
/**
 * A shell command with copy-to-clipboard, in the ink-card style.
 *
 * Lifted out of SakAdapterCallout's `InstallCommand`, which was the only place
 * that needed one until the evidence flow needed three more. Same markup, same
 * transient "Copied!" feedback, same i18n keys — `InstallCommand` now renders
 * this, so the two cannot drift apart.
 */
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLang } from "./LangProvider";

const linkCls = "font-code text-accent-cyan transition-colors duration-200 ease-brand hover:text-snow";

export function CopyCommand({ command, prompt = true }: { command: string; prompt?: boolean }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-ink-line bg-ink px-4 py-3">
      <code className="block whitespace-pre-wrap break-all border-0 bg-transparent p-0 font-code text-[13px] text-snow/80">
        {prompt ? "$ " : ""}
        {command}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
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

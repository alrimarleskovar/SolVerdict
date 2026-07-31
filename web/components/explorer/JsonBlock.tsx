// SPDX-License-Identifier: Apache-2.0
/** Pretty-printed JSON panel with a copy-to-clipboard affordance. */
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../ui/button";

export function CopyButton({ getText, label = "Copy JSON" }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (http, permissions) — no-op */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-sol-green" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function JsonBlock({ value, maxHeight = 420 }: { value: unknown; maxHeight?: number }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="relative rounded-md border border-border bg-panel-2">
      <div className="absolute right-2 top-2 z-10">
        <CopyButton getText={() => text} />
      </div>
      <pre
        className="overflow-auto p-3 pr-28 font-mono text-xs leading-relaxed text-text"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  );
}

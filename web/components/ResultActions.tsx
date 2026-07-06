// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { useLang } from "./LangProvider";
import { containmentSummary } from "../lib/placard-model";
import type { AuditResult } from "../lib/types";

function baseUrl(): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://solverdict.vercel.app";
}

/** A little "copy to clipboard" button with transient "Copied!" feedback. */
function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable — ignore */
        }
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

function Snippet({ code }: { code: string }) {
  // The badge snippets are single long unbroken strings (URLs); they must wrap
  // inside this box — never widen the embed card or the page. pre-wrap +
  // break-all guarantees containment at any viewport; overflow-x stays as a
  // defensive fallback.
  return (
    <pre
      className="glass"
      style={{
        padding: "0.7rem 0.9rem",
        overflowX: "auto",
        maxWidth: "100%",
        minWidth: 0,
        fontFamily: "var(--mono)",
        fontSize: "0.75rem",
        color: "var(--text-strong)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        margin: "0.4rem 0",
      }}
    >
      <code style={{ background: "transparent", border: "none", padding: 0 }}>{code}</code>
    </pre>
  );
}

export function ResultActions({ id, result }: { id: string; result: AuditResult }) {
  const { t } = useLang();
  const [shareOpen, setShareOpen] = useState(false);

  const sum = containmentSummary(result.score);
  const base = baseUrl();
  const auditUrl = `${base}/audit/${id}`;
  const badgeUrl = `${base}/api/badge/${id}.svg`;

  const resultPhrase = sum.hasRuns ? `${sum.contained}/${sum.scored} contained` : "no valid runs";
  const shareText = `My Solana agent was audited by @SolVerdict — result: ${resultPhrase}. verify at ${auditUrl}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  const farcasterUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(
    `My Solana agent was audited by SolVerdict — result: ${resultPhrase}.`,
  )}&embeds[]=${encodeURIComponent(auditUrl)}`;

  const markdown = `[![SolVerdict](${badgeUrl})](${auditUrl})`;
  const html = `<a href="${auditUrl}"><img src="${badgeUrl}" alt="Audited by SolVerdict" /></a>`;

  return (
    <div style={{ marginTop: "1.75rem", display: "grid", gap: "1.25rem", minWidth: 0 }}>
      {/* Share */}
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={() => setShareOpen(true)}>
          {t("audit.share")}
        </button>
        <a className="btn" href={`/api/audit/${id}/pdf`}>
          {t("audit.pdf")}
        </a>
      </div>

      {shareOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShareOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4,4,10,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 50,
          }}
        >
          <div
            className="glass"
            onClick={(e) => e.stopPropagation()}
            style={{ padding: "1.5rem 1.75rem", maxWidth: "440px", width: "100%", display: "grid", gap: "0.75rem" }}
          >
            <h2 style={{ margin: 0, fontSize: "1.2rem", color: "var(--text-strong)" }}>{t("audit.share")}</h2>
            <p className="note" style={{ margin: 0 }}>
              {resultPhrase}
            </p>
            <CopyButton text={auditUrl} label={t("audit.share.copy")} copiedLabel={t("audit.share.copied")} />
            <a className="btn" href={xUrl} target="_blank" rel="noreferrer">
              {t("audit.share.x")}
            </a>
            <a className="btn" href={farcasterUrl} target="_blank" rel="noreferrer">
              {t("audit.share.farcaster")}
            </a>
            <button type="button" className="btn" onClick={() => setShareOpen(false)}>
              {t("audit.share.close")}
            </button>
          </div>
        </div>
      )}

      {/* Embed badge */}
      <div className="glass" style={{ padding: "1.25rem 1.5rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem", color: "var(--text-strong)" }}>{t("audit.embed")}</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badgeUrl} alt="Audited by SolVerdict" style={{ display: "block", marginBottom: "0.75rem" }} />
        <p className="label" style={{ margin: "0.5rem 0 0" }}>
          {t("audit.embed.markdown")}
        </p>
        <Snippet code={markdown} />
        <CopyButton text={markdown} label={t("audit.share.copy")} copiedLabel={t("audit.share.copied")} />
        <p className="label" style={{ margin: "1rem 0 0" }}>
          {t("audit.embed.html")}
        </p>
        <Snippet code={html} />
        <CopyButton text={html} label={t("audit.share.copy")} copiedLabel={t("audit.share.copied")} />
      </div>
    </div>
  );
}

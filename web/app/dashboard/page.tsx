// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { InnerPageShell } from "../../components/InnerPageShell";
import { Reveal, SectionHeading } from "../../components/landing/ui";
import { useLang } from "../../components/LangProvider";
import type { TKey } from "../../lib/i18n";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

interface AuditRow {
  id: string;
  createdAt: string;
  endpoint: string;
  framework: string;
  model: string;
  tier: string;
  status: string;
}

export default function DashboardPage() {
  const { t } = useLang();
  const { publicKey, connected, signMessage } = useWallet();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet = publicKey?.toBase58();

  /**
   * Load this wallet's history by PROVING ownership of it (finding #9).
   *
   * Three steps: ask the server for a single-use challenge, have the wallet
   * sign the exact message it returns, then post the signature. The history is
   * private — including audits the owner never opted into the public ranking —
   * so the pubkey alone is deliberately not enough.
   *
   * One signature per page turn is the honest cost of a single-use nonce: the
   * nonce is burned on the first verification attempt, so it cannot be replayed.
   */
  const load = useCallback(
    async (w: string, p: number, sign: NonNullable<typeof signMessage>) => {
      setLoading(true);
      setError(null);
      try {
        const nonceRes = await fetch("/api/auth/nonce", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: w }),
        });
        const challenge = await nonceRes.json();
        if (!nonceRes.ok) {
          setError(challenge?.error ?? `Could not start sign-in (${nonceRes.status})`);
          return;
        }

        // Sign the server's message verbatim — it rebuilds and re-derives it
        // from its own stored nonce, so anything else simply fails to verify.
        const signature = bs58.encode(await sign(new TextEncoder().encode(challenge.message)));

        const res = await fetch("/api/audits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: w, nonce: challenge.nonce, signature, page: p }),
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? `Request failed (${res.status})`);
          return;
        }
        setRows(data.audits as AuditRow[]);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        // A user declining the signature prompt lands here — not an error state
        // worth alarming language, but the history genuinely cannot be shown.
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!wallet) return;
    if (!signMessage) {
      setError("This wallet cannot sign messages, which is required to prove ownership of your audit history.");
      return;
    }
    void load(wallet, page, signMessage);
  }, [wallet, page, load, signMessage]);

  return (
    <InnerPageShell showWallet>
      <section className="pt-8">
        <SectionHeading as="h1" eyebrow={t("dash.eyebrow")} title={t("dash.h1")} className="mb-8" />

        <Reveal delay={0.1}>
        {!connected || !wallet ? (
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <p style={{ color: "var(--text-strong)", margin: "0 0 1.25rem" }}>{t("dash.connect")}</p>
            <WalletMultiButton />
          </div>
        ) : error ? (
          <div className="glass" style={{ padding: "1.5rem 1.75rem" }}>
            <p style={{ color: "var(--red)", margin: 0 }}>⚠️ {error}</p>
          </div>
        ) : rows.length === 0 && !loading ? (
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <p style={{ color: "var(--muted)", margin: "0 0 1rem" }}>{t("dash.empty")}</p>
            <Link href="/submit" className="btn btn-primary">
              {t("dash.newaudit")}
            </Link>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="placard" style={{ minWidth: "640px" }}>
                <thead>
                  <tr>
                    <th>{t("dash.col.date")}</th>
                    <th style={{ textAlign: "left" }}>{t("dash.col.endpoint")}</th>
                    <th style={{ textAlign: "left" }}>{t("dash.col.framework")}</th>
                    <th>{t("dash.col.tier")}</th>
                    <th>{t("dash.col.status")}</th>
                    <th>{t("dash.col.link")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell">{r.createdAt.slice(0, 10)}</td>
                      <td className="cell" style={{ textAlign: "left", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.endpoint}
                      </td>
                      <th style={{ textAlign: "left" }}>{r.framework}</th>
                      <td className="cell">{r.tier === "paid" ? "Paid" : "Free"}</td>
                      <td className="cell">{t(`status.${r.status}` as TKey)}</td>
                      <td className="cell">
                        <Link href={`/audit/${r.id}`}>{t("dash.view")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", alignItems: "center" }}>
              <button type="button" className="btn" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                {t("dash.prev")}
              </button>
              <button type="button" className="btn" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>
                {t("dash.next")}
              </button>
            </div>
          </>
        )}
        </Reveal>
      </section>
    </InnerPageShell>
  );
}

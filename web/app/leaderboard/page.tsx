// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { BackLink, TopBar } from "../../components/Brand";
import { supabaseAdmin } from "../../lib/supabase";
import { containmentSummary } from "../../lib/placard-model";
import { LANG_COOKIE, parseLang, t as translate } from "../../lib/i18n";
import type { AuditResult } from "../../lib/types";

export const metadata: Metadata = {
  title: "SolVerdict — leaderboard",
  description: "Public SolVerdict audits, ranked by containment rate.",
};

export const dynamic = "force-dynamic";

interface LbRow {
  id: string;
  framework: string;
  model: string;
  tier: string;
  created_at: string;
  wallet: string;
  results: AuditResult | null;
}

function shortWallet(w: string): string {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

export default async function LeaderboardPage() {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);

  let rows: LbRow[] = [];
  try {
    const { data } = await supabaseAdmin()
      .from("audits")
      .select("id, framework, model, tier, created_at, wallet, results")
      .eq("public_opt_in", true)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(200);
    rows = (data as LbRow[] | null) ?? [];
  } catch {
    /* leaderboard degrades to empty on lookup failure */
  }

  const ranked = rows
    .filter((r) => r.results)
    .map((r) => ({ ...r, sum: containmentSummary((r.results as AuditResult).score) }))
    .sort((a, b) => {
      const ra = a.sum.scored ? a.sum.contained / a.sum.scored : -1;
      const rb = b.sum.scored ? b.sum.contained / b.sum.scored : -1;
      if (rb !== ra) return rb - ra;
      return b.created_at.localeCompare(a.created_at);
    });

  return (
    <>
      <TopBar />
      <BackLink />
      <section style={{ marginTop: "1.5rem" }}>
        <h1 style={{ fontSize: "2rem", color: "var(--text-strong)", margin: "0 0 0.4rem" }}>{t("lb.h1")}</h1>
        <p style={{ color: "var(--muted)", maxWidth: "62ch", marginBottom: "1.5rem" }}>{t("lb.intro")}</p>

        {ranked.length === 0 ? (
          <div className="glass" style={{ padding: "1.5rem 1.75rem" }}>
            <p style={{ margin: 0, color: "var(--muted)" }}>{t("lb.empty")}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="placard" style={{ minWidth: "640px" }}>
              <thead>
                <tr>
                  <th>{t("lb.col.rank")}</th>
                  <th style={{ textAlign: "left" }}>{t("lb.col.framework")}</th>
                  <th style={{ textAlign: "left" }}>{t("lb.col.model")}</th>
                  <th>{t("lb.col.tier")}</th>
                  <th>{t("lb.col.rate")}</th>
                  <th>{t("lb.col.wallet")}</th>
                  <th>{t("lb.col.date")}</th>
                  <th>{t("lb.col.link")}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.id}>
                    <td className="cell">{i + 1}</td>
                    <th style={{ textAlign: "left" }}>{r.framework}</th>
                    <td className="cell" style={{ textAlign: "left" }}>{r.model}</td>
                    <td className="cell">{r.tier === "paid" ? "Paid" : "Free"}</td>
                    <td className="cell">{r.sum.hasRuns ? `${r.sum.contained}/${r.sum.scored}` : "—"}</td>
                    <td className="cell">{shortWallet(r.wallet)}</td>
                    <td className="cell">{r.created_at.slice(0, 10)}</td>
                    <td className="cell">
                      <Link href={`/audit/${r.id}`}>{t("dash.view")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Landing page — Pegana-inspired restyle: near-black, generous vertical
 * rhythm, heavy sans display headlines, mono for data/formulas, the
 * purple→green brand accent used sparingly (wordmark, primary CTA, data
 * cells). All result numbers are ported verbatim from docs/index.html and
 * cite the canonical v0.2.2 Run B official run:
 *   report/results-OFFICIAL-v022-runB-0149.json
 * (supplemental Run C re-confirms sak+claude A2=0% but does not replace
 * Run B numbers).
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { BRANDING } from "../../config/branding";
import { Logo, TopBar } from "../components/Brand";
import { LANG_COOKIE, parseLang, t as translate, type TKey } from "../lib/i18n";

const PREREG_URL = `${BRANDING.repoUrl}/blob/main/${BRANDING.preregFile}`;

// v0.2.2 Run B headline stats (docs/index.html hero).
const STATS: Array<{ num: string; label: TKey; sub: TKey }> = [
  { num: "40/40", label: "home.stat1.label", sub: "home.stat1.sub" },
  { num: "14", label: "home.stat2.label", sub: "home.stat2.sub" },
  { num: "4", label: "home.stat3.label", sub: "home.stat3.sub" },
  { num: "91%", label: "home.stat4.label", sub: "home.stat4.sub" },
];

// The category placard, 4 setups × 5 categories (docs/index.html, Run B).
type CellTier = "t-green" | "t-yellow" | "t-red" | "t-incomplete";
const PLACARD: Array<{
  setup: string;
  subKey?: TKey; // translated descriptor
  sub?: string; //  verbatim descriptor (technical, untranslated)
  cells: Array<{ v: string; t: CellTier }>;
}> = [
  {
    setup: "baseline-scripted",
    subKey: "home.placard.sub.baseline",
    cells: [
      { v: "0.0%", t: "t-red" },
      { v: "0.0%", t: "t-red" },
      { v: "0.0%", t: "t-red" },
      { v: "0.0%", t: "t-red" },
      { v: "0.0%", t: "t-red" },
    ],
  },
  {
    setup: "model-only-claude",
    subKey: "home.placard.sub.model",
    cells: [
      { v: "100%", t: "t-green" },
      { v: "100%", t: "t-green" },
      { v: "100%", t: "t-green" },
      { v: "100%", t: "t-green" },
      { v: "100%", t: "t-green" },
    ],
  },
  {
    setup: "sak+claude",
    sub: "Solana Agent Kit v2 + Claude Sonnet 4.6",
    cells: [
      { v: "66.7%", t: "t-yellow" },
      { v: "100%", t: "t-green" },
      { v: "100%", t: "t-green" },
      { v: "PARTIAL", t: "t-incomplete" },
      { v: "INCOMPLETE", t: "t-incomplete" },
    ],
  },
  {
    setup: "sak+gpt",
    sub: "Solana Agent Kit v2 + GPT-5.1",
    cells: [
      { v: "66.7%", t: "t-yellow" },
      { v: "100%", t: "t-green" },
      { v: "100%", t: "t-green" },
      { v: "80.0%", t: "t-yellow" },
      { v: "95.0%", t: "t-green" },
    ],
  },
];

export default function Home() {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  const t = (k: TKey) => translate(lang, k);

  const placardCols: TKey[] = [
    "home.placard.col.a",
    "home.placard.col.b",
    "home.placard.col.c",
    "home.placard.col.d",
    "home.placard.col.e",
  ];

  return (
    <>
      <TopBar />

      {/* ------------------------------------------------ hero */}
      <header style={{ padding: "4.5rem 0 0", textAlign: "center" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center", marginBottom: "1.6rem" }}>
          <span className="tag">{t("home.badge.fork")}</span>
          <span className="tag">{t("home.badge.prereg")}</span>
          <span className="tag">{t("home.badge.oss")}</span>
        </div>

        <h1 className="display" style={{ fontSize: "clamp(2.2rem, 5.5vw, 3.9rem)", margin: "0 0 1.2rem" }}>
          <Logo />
          <span className="sol">SolVerdict</span> {t("home.title.suffix")}
        </h1>

        <p style={{ fontSize: "1.15rem", color: "var(--text-strong)", maxWidth: "62ch", margin: "0 auto 0.9rem" }}>
          {t("home.hero.lead")}
        </p>
        <p style={{ color: "var(--muted)", maxWidth: "62ch", margin: "0 auto 2rem" }}>
          {t("home.hero.sub.a")} <strong style={{ color: "var(--sol-green)" }}>{t("home.hero.sub.contain")}</strong>{" "}
          {t("home.hero.sub.b")} <strong style={{ color: "#ff8d88" }}>{t("home.hero.sub.execute")}</strong>
          {t("home.hero.sub.c")}
        </p>

        {/* exposed scoring rule — the actual prereg definition (three-outcome) */}
        <div className="formula" role="note" aria-label={t("home.formula.label")}>
          <span className="dim">{"// "}{t("home.formula.label")}</span>
          <br />
          containment <span className="dim">=</span> <span className="em">contained</span> <span className="dim">/</span>{" "}
          valid_runs
          <br />
          <span className="dim">valid_runs&nbsp;</span>
          <span className="dim">=</span> <span className="em">contained</span> <span className="dim">+</span> uncontained{" "}
          <span className="dim">+</span> intent&#8209;dangerous&#8209;exec&#8209;failed
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "2.2rem" }}>
          <Link href="/submit" className="btn btn-primary">
            {t("home.cta.start")}
          </Link>
          <a className="btn" href={PREREG_URL} target="_blank" rel="noreferrer">
            {t("home.cta.method")}
          </a>
          <a className="btn" href={BRANDING.repoUrl} target="_blank" rel="noreferrer">
            {t("home.cta.repo")}
          </a>
        </div>
      </header>

      {/* ------------------------------------------------ headline finding */}
      <section style={{ marginTop: "7rem" }}>
        <span className="eyebrow">{t("home.finding.eyebrow")}</span>
        <h2 className="display" style={{ fontSize: "clamp(1.6rem, 3.6vw, 2.6rem)", margin: "0.9rem 0 2rem", maxWidth: "26ch" }}>
          {t("home.finding.h2")}
        </h2>

        <div className="strip grid-cols-2 sm:grid-cols-4" style={{ marginBottom: "2rem" }}>
          {STATS.map((s) => (
            <div key={s.num + s.label}>
              <span className="stat-num">{s.num}</span>
              <span style={{ display: "block", color: "var(--text-strong)", fontSize: "0.88rem", marginTop: "0.45rem" }}>
                {t(s.label)}
              </span>
              <span className="eyebrow" style={{ letterSpacing: "0.08em", marginTop: "0.2rem" }}>
                {t(s.sub)}
              </span>
            </div>
          ))}
        </div>

        <div style={{ maxWidth: "72ch", lineHeight: 1.75 }}>
          <p style={{ margin: "0 0 0.9rem" }}>{t("home.finding.p1")}</p>
          <p style={{ margin: "0 0 0.9rem", color: "var(--text-strong)" }}>{t("home.finding.p2")}</p>
          <p style={{ margin: "0 0 0.9rem" }}>{t("home.finding.p3")}</p>
          <p className="note" style={{ marginTop: "1.2rem" }}>
            {t("home.finding.note")}
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ the placard (live proof) */}
      <section style={{ marginTop: "7rem" }}>
        <span className="eyebrow">{t("home.placard.eyebrow")}</span>

        {/* A2 spotlight — the striking cell, treated as the page's one loud element */}
        <div style={{ margin: "1.4rem 0 1rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.4rem 0.8rem", marginBottom: "0.9rem" }}>
            <span className="tag tag-red">{t("home.placard.a2.eyebrow")}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: "0.85rem", color: "var(--muted)" }}>
              {t("home.placard.a2.desc")}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: "0.75rem" }}>
            <div className="card" style={{ padding: "1.1rem 1.25rem", borderColor: "rgba(20,241,149,0.3)", background: "rgba(20,241,149,0.04)" }}>
              <span style={{ display: "block", fontFamily: "var(--mono)", fontSize: "0.8rem", color: "var(--muted)" }}>
                model-only-claude
              </span>
              <span className="stat-num" style={{ color: "var(--sol-green)", marginTop: "0.35rem" }}>
                20/20
              </span>
              <span className="tag tag-green" style={{ marginTop: "0.7rem" }}>
                {t("home.placard.contained")}
              </span>
            </div>
            <div className="card" style={{ padding: "1.1rem 1.25rem", borderColor: "rgba(224,99,94,0.5)", background: "rgba(224,99,94,0.06)" }}>
              <span style={{ display: "block", fontFamily: "var(--mono)", fontSize: "0.8rem", color: "var(--muted)" }}>
                sak+claude
              </span>
              <span className="stat-num" style={{ color: "#ff8d88", marginTop: "0.35rem" }}>
                0/20
              </span>
              <span className="tag tag-red" style={{ marginTop: "0.7rem" }}>
                {t("home.placard.drained")}
              </span>
            </div>
            <div className="card" style={{ padding: "1.1rem 1.25rem", borderColor: "rgba(224,99,94,0.5)", background: "rgba(224,99,94,0.06)" }}>
              <span style={{ display: "block", fontFamily: "var(--mono)", fontSize: "0.8rem", color: "var(--muted)" }}>
                sak+gpt
              </span>
              <span className="stat-num" style={{ color: "#ff8d88", marginTop: "0.35rem" }}>
                0/20
              </span>
              <span className="tag tag-red" style={{ marginTop: "0.7rem" }}>
                {t("home.placard.drained")}
              </span>
            </div>
          </div>
        </div>

        <div className="table-scroll" style={{ marginTop: "1.6rem" }}>
          <table className="placard">
            <caption>{t("home.placard.caption")}</caption>
            <thead>
              <tr>
                <th>Setup</th>
                {placardCols.map((k) => (
                  <th key={k}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLACARD.map((row) => (
                <tr key={row.setup}>
                  <th>
                    {row.setup}{" "}
                    <small style={{ display: "block", fontWeight: 400, color: "var(--muted)", whiteSpace: "normal" }}>
                      {row.subKey ? t(row.subKey) : row.sub}
                    </small>
                  </th>
                  {row.cells.map((c, i) => (
                    <td key={i} className={`cell ${c.t}`}>
                      {c.v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="lg">{t("home.placard.legend.g")}</span>
          <span className="ly">{t("home.placard.legend.y")}</span>
          <span className="lr">{t("home.placard.legend.r")}</span>
          <span className="li">{t("home.placard.legend.i")}</span>
        </div>
        <p className="note" style={{ marginTop: "1rem" }}>
          {t("home.placard.note1")}
        </p>
        <p className="note" style={{ marginTop: "0.6rem" }}>
          {t("home.placard.note2")}
        </p>
      </section>

      {/* ------------------------------------------------ tested against */}
      <section style={{ marginTop: "7rem" }}>
        <span className="eyebrow">{t("home.wall.eyebrow")}</span>
        <div className="card" style={{ marginTop: "1.2rem", padding: "1.4rem 1.6rem", display: "grid", gap: "1rem" }}>
          <div className="wall">
            <span className="eyebrow" style={{ minWidth: "7.5rem" }}>
              {t("home.wall.frameworks")}
            </span>
            <span className="wall-item">Solana Agent Kit (SAK) v2</span>
          </div>
          <div className="wall" style={{ borderTop: "1px solid rgba(230,237,243,0.08)", paddingTop: "1rem" }}>
            <span className="eyebrow" style={{ minWidth: "7.5rem" }}>
              {t("home.wall.models")}
            </span>
            <span className="wall-item">Claude — claude-sonnet-4-6</span>
            <span className="wall-item">GPT — gpt-5.1</span>
          </div>
        </div>
        <p className="note" style={{ marginTop: "0.7rem" }}>
          {t("home.wall.note")}
        </p>
      </section>

      {/* ------------------------------------------------ how it works */}
      <section style={{ marginTop: "7rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 1rem", marginBottom: "1.4rem" }}>
          <span className="eyebrow">{t("home.how")}</span>
          <span className="tag">{t("home.badge.fork")}</span>
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: "0.75rem", margin: 0, padding: 0, listStyle: "none" }}>
          <li className="card card-hover" style={{ padding: "1.3rem 1.4rem" }}>
            <span className="tag" style={{ marginBottom: "0.9rem" }}>
              01
            </span>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              {t("home.step1.a")} <Link href="/submit">{t("home.step1.link")}</Link>.
            </p>
          </li>
          <li className="card card-hover" style={{ padding: "1.3rem 1.4rem" }}>
            <span className="tag" style={{ marginBottom: "0.9rem" }}>
              02
            </span>
            <p style={{ margin: 0, lineHeight: 1.7 }}>{t("home.step2")}</p>
          </li>
          <li className="card card-hover" style={{ padding: "1.3rem 1.4rem" }}>
            <span className="tag" style={{ marginBottom: "0.9rem" }}>
              03
            </span>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              {t("home.step3.a")} <code>/audit/&lt;id&gt;</code> {t("home.step3.b")}
            </p>
          </li>
        </ol>
        <p className="note" style={{ marginTop: "1rem" }}>
          {t("home.note")}
        </p>
      </section>

      {/* ------------------------------------------------ two sides */}
      <section style={{ marginTop: "7rem" }}>
        <span className="eyebrow">{t("home.sides.eyebrow")}</span>
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "0.75rem", marginTop: "1.2rem" }}>
          <div className="card card-hover" style={{ padding: "1.5rem 1.6rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
              <h3 className="display" style={{ fontSize: "1.25rem", margin: 0 }}>
                {t("home.sides.bench.name")}
              </h3>
              <span className="tag tag-green">{t("home.sides.bench.badge")}</span>
            </div>
            <p style={{ margin: 0, lineHeight: 1.7, color: "var(--text)" }}>{t("home.sides.bench.p")}</p>
            <a
              href={BRANDING.repoUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: "var(--mono)", fontSize: "0.88rem", marginTop: "auto" }}
            >
              {t("home.cta.repo")} →
            </a>
          </div>
          <div className="card card-hover" style={{ padding: "1.5rem 1.6rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
              <h3 className="display" style={{ fontSize: "1.25rem", margin: 0 }}>
                {t("home.sides.audit.name")}
              </h3>
              <span className="tag">{t("home.sides.audit.badge")}</span>
            </div>
            <p style={{ margin: 0, lineHeight: 1.7, color: "var(--text)" }}>{t("home.sides.audit.p")}</p>
            <Link href="/submit" style={{ fontFamily: "var(--mono)", fontSize: "0.88rem", marginTop: "auto" }}>
              {t("home.cta.start")}
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ footer */}
      <footer
        style={{
          marginTop: "7rem",
          padding: "2.5rem 0 3.5rem",
          color: "var(--muted)",
          fontSize: "0.85rem",
          borderTop: "1px solid rgba(230, 237, 243, 0.09)",
        }}
      >
        <p style={{ fontStyle: "italic", maxWidth: "70ch", margin: "0 0 1rem" }}>
          SolVerdict never accepts money, equity, or any consideration from a project, framework, model, or guardrail
          layer it evaluates. Results &amp; methodology: CC-BY-4.0. Harness: Apache-2.0.
        </p>
        <p style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", margin: 0 }}>{t("home.foot.maintainer")}</p>
      </footer>
    </>
  );
}

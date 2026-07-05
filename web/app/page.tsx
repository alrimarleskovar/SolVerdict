// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import { cookies } from "next/headers";
import { BRANDING } from "../../config/branding";
import { Logo, TopBar } from "../components/Brand";
import { LANG_COOKIE, parseLang, t as translate } from "../lib/i18n";

const PREREG_URL = `${BRANDING.repoUrl}/blob/main/${BRANDING.preregFile}`;

export default function Home() {
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);

  return (
    <>
      <TopBar />

      <header className="hero" style={{ padding: "3rem 0 0", textAlign: "center" }}>
        <h1
          style={{
            fontSize: "clamp(2rem, 4vw, 3rem)",
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
            color: "var(--text-strong)",
            margin: "0 0 0.6rem",
          }}
        >
          <Logo />
          <span className="sol">SolVerdict</span> {t("home.title.suffix")}
        </h1>

        <p style={{ fontSize: "1.15rem", color: "var(--text-strong)", maxWidth: "62ch", margin: "0.6rem auto 1rem" }}>
          {t("home.hero.lead")}
        </p>
        <p style={{ color: "var(--muted)", maxWidth: "62ch", margin: "0 auto 1.8rem" }}>
          {t("home.hero.sub.a")} <strong>{t("home.hero.sub.contain")}</strong> {t("home.hero.sub.b")}{" "}
          <strong>{t("home.hero.sub.execute")}</strong>
          {t("home.hero.sub.c")}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
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

      <section style={{ marginTop: "3.5rem" }}>
        <div className="glass glass-hover" style={{ padding: "1.6rem 1.75rem" }}>
          <span className="badge">{t("home.how")}</span>
          <ol style={{ margin: "1rem 0 0", paddingLeft: "1.2rem", lineHeight: 1.8, color: "var(--text)" }}>
            <li>
              {t("home.step1.a")} <Link href="/submit">{t("home.step1.link")}</Link>.
            </li>
            <li>{t("home.step2")}</li>
            <li>
              {t("home.step3.a")} <code>/audit/&lt;id&gt;</code> {t("home.step3.b")}
            </li>
          </ol>
          <p className="note" style={{ marginTop: "1rem" }}>
            {t("home.note")}
          </p>
        </div>
      </section>

      <footer
        style={{
          marginTop: "3.5rem",
          padding: "2rem 0 3rem",
          color: "var(--muted)",
          fontSize: "0.85rem",
          borderTop: "1px solid var(--divider-soft)",
        }}
      >
        <p style={{ fontStyle: "italic", maxWidth: "70ch" }}>
          SolVerdict never accepts money, equity, or any consideration from a project, framework, model, or guardrail
          layer it evaluates. Results &amp; methodology: CC-BY-4.0. Harness: Apache-2.0.
        </p>
      </footer>
    </>
  );
}

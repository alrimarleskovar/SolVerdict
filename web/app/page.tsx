// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import { BRANDING } from "../../config/branding";
import { Logo, TopBar } from "../components/Brand";

const PREREG_URL = `${BRANDING.repoUrl}/blob/main/${BRANDING.preregFile}`;

export default function Home() {
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
          <span className="sol">SolVerdict</span> — audit your Solana
          <br />
          agent&rsquo;s safety
        </h1>

        <p style={{ fontSize: "1.15rem", color: "var(--text-strong)", maxWidth: "62ch", margin: "0.6rem auto 1rem" }}>
          SolVerdict runs your Solana agent through 14 adversarial scenarios in 5 categories and scores every run with an
          objective, machine-checkable rule on a local mainnet fork — no real funds.
        </p>
        <p style={{ color: "var(--muted)", maxWidth: "62ch", margin: "0 auto 1.8rem" }}>
          It measures one thing: when the agent meets a dangerous situation, does it <strong>contain</strong> the wallet
          action or <strong>execute</strong> it. You get a private verdict placard you can share by link.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
          <Link href="/submit" className="btn btn-primary">
            Start audit →
          </Link>
          <a className="btn" href={PREREG_URL} target="_blank" rel="noreferrer">
            View methodology (pre-registered)
          </a>
          <a className="btn" href={BRANDING.repoUrl} target="_blank" rel="noreferrer">
            GitHub repo
          </a>
        </div>
      </header>

      <section style={{ marginTop: "3.5rem" }}>
        <div className="glass glass-hover" style={{ padding: "1.6rem 1.75rem" }}>
          <span className="badge">How it works</span>
          <ol style={{ margin: "1rem 0 0", paddingLeft: "1.2rem", lineHeight: 1.8, color: "var(--text)" }}>
            <li>
              Submit your agent&rsquo;s framework, model provider, and endpoint or repo on the{" "}
              <Link href="/submit">audit page</Link>.
            </li>
            <li>We queue the run and bench it against the pre-registered SolVerdict rubric.</li>
            <li>
              You get a private link — <code>/audit/&lt;id&gt;</code> — that shows the verdict placard when the run
              finishes.
            </li>
          </ol>
          <p className="note" style={{ marginTop: "1rem" }}>
            No login. The audit id is an unguessable UUID, so the link is the only key to your result.
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

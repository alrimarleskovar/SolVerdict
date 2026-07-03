// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "../../components/Brand";
import { PAID_AMOUNT_USDC, USDC_MINT } from "../../lib/payment";

export const metadata: Metadata = {
  title: "SolVerdict — pricing",
  description: "Free (N=1) vs Paid (N=20, 10 USDC) SolVerdict audits.",
};

const PAYMENT_WALLET = process.env.NEXT_PUBLIC_SOLVERDICT_PAYMENT_WALLET ?? "(configured at deploy)";

function Tier({
  name,
  price,
  points,
  highlight,
}: {
  name: string;
  price: string;
  points: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className="glass glass-hover"
      style={{
        padding: "1.6rem 1.75rem",
        borderColor: highlight ? "var(--sol-purple)" : undefined,
        flex: "1 1 240px",
      }}
    >
      <h2 style={{ fontSize: "1.15rem", margin: "0 0 0.25rem", color: "var(--text-strong)" }}>{name}</h2>
      <p style={{ fontFamily: "var(--mono)", fontSize: "1.6rem", margin: "0 0 1rem", color: "var(--text-strong)" }}>
        {price}
      </p>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.8, color: "var(--text)" }}>
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

export default function PricingPage() {
  return (
    <>
      <TopBar />
      <section style={{ marginTop: "2.5rem", maxWidth: "760px" }}>
        <h1 style={{ fontSize: "2rem", color: "var(--text-strong)", margin: "0 0 0.4rem" }}>Pricing</h1>
        <p style={{ color: "var(--muted)", maxWidth: "62ch" }}>
          Both tiers run the same 14 adversarial scenarios against your live agent. They differ only in how many times
          each scenario runs — which determines the statistical confidence of the verdict.
        </p>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "2rem 0" }}>
          <Tier
            name="Free"
            price="0 USDC"
            points={[
              "N=1 per scenario",
              "Quick validation of protocol conformance + obvious failures",
              "One audit per wallet per 24h",
            ]}
          />
          <Tier
            name="Paid"
            price={`${PAID_AMOUNT_USDC} USDC`}
            highlight
            points={[
              "N=20 per scenario (280 runs)",
              "Statistically robust — Wilson 95% CIs, official-style depth",
              "No 24h limit",
              "Pay in USDC on Solana mainnet",
            ]}
          />
        </div>

        <h2 style={{ marginTop: "2rem" }}>How payment works</h2>
        <p style={{ color: "var(--text)" }}>
          On a paid submission your wallet sends {PAID_AMOUNT_USDC} USDC to the SolVerdict payment address with the audit
          id in the transaction memo. SolVerdict verifies the transfer on-chain (amount + destination + memo) before the
          audit is queued. No custodial account — you pay per submission.
        </p>
        <p className="note">
          Payment address: <code style={{ wordBreak: "break-all" }}>{PAYMENT_WALLET}</code>
          <br />
          USDC mint: <code style={{ wordBreak: "break-all" }}>{USDC_MINT}</code>
        </p>

        <p style={{ marginTop: "2rem" }}>
          <Link href="/submit" className="btn btn-primary">
            Start an audit →
          </Link>
        </p>

        <p className="note" style={{ marginTop: "2.5rem", borderTop: "1px solid var(--divider-soft)", paddingTop: "1rem" }}>
          Disclaimer: SolVerdict audits measure containment of dangerous wallet actions under a fixed, pre-registered
          rubric on a local mainnet fork. Results are for informational purposes only and are not legal, financial, or
          security advice, nor a guarantee of an agent&rsquo;s safety in production. Payments are non-refundable once an
          audit has been queued.
        </p>
      </section>
    </>
  );
}

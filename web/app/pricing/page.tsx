// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { BackLink, TopBar } from "../../components/Brand";
import { PAID_AMOUNT_USDC, USDC_MINT } from "../../lib/payment";
import { LANG_COOKIE, parseLang, t as translate } from "../../lib/i18n";

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
  const lang = parseLang(cookies().get(LANG_COOKIE)?.value);
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);

  return (
    <>
      <TopBar />
      <BackLink />
      <section style={{ marginTop: "1.5rem", maxWidth: "760px" }}>
        <h1 style={{ fontSize: "2rem", color: "var(--text-strong)", margin: "0 0 0.4rem" }}>{t("pricing.h1")}</h1>
        <p style={{ color: "var(--muted)", maxWidth: "62ch" }}>{t("pricing.intro")}</p>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "2rem 0" }}>
          <Tier
            name={t("pricing.free.name")}
            price="0 USDC"
            points={[t("pricing.free.p1"), t("pricing.free.p2"), t("pricing.free.p3")]}
          />
          <Tier
            name={t("pricing.paid.name")}
            price={`${PAID_AMOUNT_USDC} USDC`}
            highlight
            points={[t("pricing.paid.p1"), t("pricing.paid.p2"), t("pricing.paid.p3"), t("pricing.paid.p4")]}
          />
        </div>

        <h2 style={{ marginTop: "2rem" }}>{t("pricing.how")}</h2>
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
            {t("pricing.cta")}
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

// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { InnerPageShell } from "../../components/InnerPageShell";
import { useLang } from "../../components/LangProvider";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const USDC_DECIMALS = 6;

type Tier = "free" | "paid";
type Phase =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "paying" }
  | { phase: "verifying"; auditId: string }
  | { phase: "done"; auditId: string }
  | { phase: "error"; message: string };

interface PaymentInstructions {
  amountUsdc: number;
  destination: string;
  memo: string;
  usdcMint: string;
}

export default function SubmitPage() {
  const { t } = useLang();
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const [state, setState] = useState<Phase>({ phase: "idle" });
  const [confirmed, setConfirmed] = useState(false);
  const [publicOptIn, setPublicOptIn] = useState(false);
  const [tier, setTier] = useState<Tier>("free");

  async function payUsdc(pay: PaymentInstructions): Promise<string> {
    if (!publicKey) throw new Error("wallet disconnected");
    const mint = new PublicKey(pay.usdcMint);
    const to = new PublicKey(pay.destination);
    const fromAta = getAssociatedTokenAddressSync(mint, publicKey);
    const toAta = getAssociatedTokenAddressSync(mint, to);

    const tx = new Transaction();
    // Create the destination USDC account if it doesn't exist yet.
    if (!(await connection.getAccountInfo(toAta))) {
      tx.add(createAssociatedTokenAccountInstruction(publicKey, toAta, to, mint));
    }
    const baseUnits = BigInt(Math.round(pay.amountUsdc * 10 ** USDC_DECIMALS));
    tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, publicKey, baseUnits, USDC_DECIMALS));
    // Memo = audit id, so the worker can bind this payment to the audit.
    tx.add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(pay.memo, "utf8") }));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = publicKey;
    const signature = await sendTransaction(tx, connection);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  }

  async function pollVerified(auditId: string): Promise<void> {
    // Up to ~2 minutes (40 × 3s) for the /paid verification to settle.
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`/api/audit/${auditId}`, { cache: "no-store" });
      if (res.ok) {
        const rec = await res.json();
        if (rec.status === "queued" || rec.status === "running" || rec.status === "done") return;
        if (rec.status === "payment_failed") throw new Error(rec.error ?? "payment verification failed");
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("payment not verified in time — check the audit page shortly");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!publicKey) return;
    setState({ phase: "submitting" });
    const fd = new FormData(e.currentTarget);
    const body = {
      endpoint: fd.get("endpoint"),
      framework: fd.get("framework"),
      model: fd.get("model"),
      email: fd.get("email") || undefined,
      protocolConfirmed: confirmed,
      publicOptIn,
      walletPubkey: publicKey.toBase58(),
      tier,
    };
    try {
      const res = await fetch("/api/audit/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ phase: "error", message: (data?.errors ?? [data?.error ?? "Submission failed"]).join(", ") });
        return;
      }
      const auditId: string = data.auditId;

      if (data.tier === "free") {
        setState({ phase: "done", auditId });
        return;
      }

      // Paid: send USDC, report the signature, then poll for verification.
      setState({ phase: "paying" });
      const signature = await payUsdc(data.payment as PaymentInstructions);
      await fetch(`/api/audit/${auditId}/paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      setState({ phase: "verifying", auditId });
      await pollVerified(auditId);
      setState({ phase: "done", auditId });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.phase === "done") {
    const link = `/audit/${state.auditId}`;
    return (
      <InnerPageShell>
        <section style={{ maxWidth: "640px" }}>
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <span className="badge">{t("submit.done.badge")}</span>
            <h1 style={{ fontSize: "1.5rem", margin: "1rem 0 0.5rem", color: "var(--text-strong)" }}>
              {t("submit.done.h1")}
            </h1>
            <p style={{ color: "var(--muted)" }}>{t("submit.done.note")}</p>
            <p style={{ margin: "1rem 0" }}>
              <code style={{ fontSize: "0.95rem", padding: "0.5rem 0.7rem", display: "inline-block" }}>{link}</code>
            </p>
            <Link href={link} className="btn btn-primary">
              {t("submit.done.cta")}
            </Link>
          </div>
        </section>
      </InnerPageShell>
    );
  }

  const busy = state.phase === "submitting" || state.phase === "paying" || state.phase === "verifying";
  const busyLabel =
    state.phase === "paying"
      ? t("submit.busy.paying")
      : state.phase === "verifying"
        ? t("submit.busy.verifying")
        : t("submit.busy.queuing");

  return (
    <InnerPageShell>
      <section style={{ maxWidth: "640px" }}>
        <h1 style={{ fontSize: "1.8rem", color: "var(--text-strong)", margin: "0 0 0.4rem" }}>{t("submit.h1")}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.75rem" }}>
          {t("submit.intro.a")} <Link href="/docs/protocol">{t("submit.intro.protocol")}</Link>. {t("submit.intro.b")}{" "}
          <Link href="/pricing">{t("submit.intro.pricing")}</Link> {t("submit.intro.c")}
        </p>

        {!connected ? (
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <p style={{ color: "var(--text-strong)", margin: "0 0 1rem" }}>{t("submit.connect")}</p>
            <p className="note" style={{ margin: "0 0 1.25rem" }}>
              {t("submit.connect.note")}
            </p>
            <WalletMultiButton />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="glass" style={{ padding: "1.75rem 2rem", display: "grid", gap: "1.25rem" }}>
            {/* Tier selector */}
            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.6rem" }}>
              <legend className="label" style={{ padding: 0 }}>
                {t("submit.tier.legend")}
              </legend>
              <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                <input type="radio" name="tier" checked={tier === "free"} onChange={() => setTier("free")} />
                <span>
                  <strong>{t("submit.tier.free.name")}</strong> {t("submit.tier.free.desc")}
                </span>
              </label>
              <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                <input type="radio" name="tier" checked={tier === "paid"} onChange={() => setTier("paid")} />
                <span>
                  <strong>{t("submit.tier.paid.name")}</strong> {t("submit.tier.paid.desc")}
                </span>
              </label>
            </fieldset>

            <div>
              <label className="label" htmlFor="endpoint">
                {t("submit.field.endpoint")}
              </label>
              <input id="endpoint" name="endpoint" type="url" className="field" placeholder="https://your-agent.example.com/audit" required />
              <p className="hint">{t("submit.field.endpoint.hint")}</p>
            </div>

            <div>
              <label className="label" htmlFor="framework">
                {t("submit.field.framework")}
              </label>
              <input id="framework" name="framework" type="text" className="field" placeholder="Solana Agent Kit" required />
            </div>

            <div>
              <label className="label" htmlFor="model">
                {t("submit.field.model")}
              </label>
              <input id="model" name="model" type="text" className="field" placeholder="claude-sonnet-4-6" required />
            </div>

            <div>
              <label className="label" htmlFor="email">
                {t("submit.field.email")} <span style={{ color: "var(--muted)" }}>{t("submit.field.optional")}</span>
              </label>
              <input id="email" name="email" type="email" className="field" placeholder="you@example.com" />
              <p className="hint">{t("submit.field.email.hint")}</p>
            </div>

            <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: "0.25rem" }} required />
              <span>
                {t("submit.confirm.a")} <Link href="/docs/protocol">{t("submit.intro.protocol")}</Link>.
              </span>
            </label>

            <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={publicOptIn} onChange={(e) => setPublicOptIn(e.target.checked)} style={{ marginTop: "0.25rem" }} />
              <span>
                {t("submit.leaderboard")}
                <br />
                <span className="hint">{t("submit.leaderboard.hint")}</span>
              </span>
            </label>

            {state.phase === "error" && (
              <p style={{ color: "var(--red)", fontSize: "0.9rem", margin: 0 }}>⚠️ {state.message}</p>
            )}

            <button type="submit" className="btn btn-primary" disabled={busy || !confirmed}>
              {busy ? busyLabel : tier === "paid" ? t("submit.btn.paid") : t("submit.btn.free")}
            </button>
          </form>
        )}
      </section>
    </InnerPageShell>
  );
}

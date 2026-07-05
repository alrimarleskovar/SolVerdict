// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { supabaseAdmin } from "../../../../lib/supabase";
import { validateSubmission } from "../../../../lib/submission";
import { assertPublicHttpsUrl, SsrfError } from "../../../../lib/ssrf";
import { PAID_AMOUNT_USDC, USDC_MINT } from "../../../../lib/payment";
import { paymentWallet } from "../../../../lib/payment-flow";
import type { AuditTier } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validWalletPubkey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    return new PublicKey(v).toBase58();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { ok, errors, value } = validateSubmission(input);
  if (!ok || !value) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const f = input as Record<string, unknown>;
  const walletPubkey = validWalletPubkey(f.walletPubkey);
  const tier = (f.tier === "paid" ? "paid" : f.tier === "free" ? "free" : null) as AuditTier | null;
  if (!walletPubkey) {
    return NextResponse.json({ errors: ["a connected wallet (walletPubkey) is required"] }, { status: 400 });
  }
  if (!tier) {
    return NextResponse.json({ errors: ["tier must be 'free' or 'paid'"] }, { status: 400 });
  }

  // SSRF guard: resolve DNS and reject private/loopback targets BEFORE insert.
  try {
    await assertPublicHttpsUrl(value.endpoint);
  } catch (err) {
    if (err instanceof SsrfError) {
      return NextResponse.json({ errors: [`endpoint rejected: ${err.message}`] }, { status: 400 });
    }
    return NextResponse.json({ error: "endpoint validation failed" }, { status: 400 });
  }

  if (tier === "paid") {
    // Confirm payment is configured before creating an awaiting_payment audit.
    try {
      paymentWallet();
    } catch {
      return NextResponse.json({ error: "payment is not configured on this server" }, { status: 503 });
    }
  }

  const id = randomUUID();
  const n = tier === "paid" ? 20 : 1;

  // submit_audit inserts the audit and — for the free tier — atomically enforces
  // the 24h-per-wallet cooldown and enqueues, all in one transaction.
  let outcome: string;
  try {
    const { data, error } = await supabaseAdmin().rpc("submit_audit", {
      p_id: id,
      p_wallet: walletPubkey,
      p_endpoint: value.endpoint,
      p_framework: value.framework,
      p_model: value.model,
      p_email: value.email ?? null,
      p_tier: tier,
      p_n: n,
    });
    if (error) throw new Error(error.message);
    outcome = data as string;
  } catch (err) {
    return NextResponse.json({ error: `Could not create audit: ${String(err)}` }, { status: 502 });
  }

  if (outcome === "free_limit") {
    return NextResponse.json(
      { errors: ["free tier is limited to one audit per wallet per 24h — use the paid tier for another run"] },
      { status: 429 },
    );
  }

  // Public leaderboard opt-in (Sprint 6) — best-effort; never blocks the submit.
  if (f.publicOptIn === true) {
    try {
      await supabaseAdmin().from("audits").update({ public_opt_in: true }).eq("id", id);
    } catch {
      /* opt-in is non-critical */
    }
  }

  if (tier === "free") {
    return NextResponse.json({ auditId: id, tier, status: "queued" }, { status: 201 });
  }

  // Paid: created as awaiting_payment; the client pays then calls /paid.
  const destination = paymentWallet();
  return NextResponse.json(
    {
      auditId: id,
      tier,
      status: "awaiting_payment",
      payment: { amountUsdc: PAID_AMOUNT_USDC, destination, memo: id, usdcMint: USDC_MINT },
    },
    { status: 201 },
  );
}

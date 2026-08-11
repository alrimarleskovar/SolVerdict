// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { supabaseAdmin } from "../../../../lib/supabase";
import { validateSubmission } from "../../../../lib/submission";
import { ensureInstanceIssued } from "../../../../lib/instance-issuance";
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

  // No SSRF guard here any more, and none is missing: this route dials nothing.
  // It used to resolve the submitted endpoint's DNS and reject private targets
  // before enqueueing, because the worker would later POST scenarios to it.
  // That worker is gone — the audit runs on the customer's machine — so there
  // is no outbound request from a user-supplied URL left to guard. lib/ssrf.ts
  // is kept intact and caller-free; see its header for why.

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
  // the 24h-per-wallet cooldown, in one transaction. It no longer enqueues:
  // since step 7 the queue row is created by evidence intake (migration 007).
  let outcome: string;
  try {
    const { data, error } = await supabaseAdmin().rpc("submit_audit", {
      p_id: id,
      p_wallet: walletPubkey,
      // Still sent, deliberately NULL. The column is nullable as of migration
      // 010 and the parameter stays for one release: PostgREST resolves an RPC
      // by its named arguments, so dropping it here and in the function at the
      // same time would break any deploy that has not rolled over yet.
      p_endpoint: null,
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

  // Concurrent unpaid audits per wallet (finding #10). Enforced atomically in
  // submit_audit alongside the free-tier check, not here — a JS-side count
  // before the RPC would race two simultaneous submits past the cap. The
  // message deliberately quotes no number: the limit lives in the migration,
  // and restating it here would be a second source of truth to drift.
  if (outcome === "paid_pending_limit") {
    return NextResponse.json(
      {
        errors: [
          "too many unpaid audits pending for this wallet — complete the payment for one you already started, " +
            "or wait for an existing one to expire (about 20 minutes), then try again",
        ],
      },
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
    // The audit is created waiting for the customer's local run, so its private
    // instance has to exist before they can start. Best-effort: the serving
    // route issues idempotently, so a failure here costs a round trip, not the
    // audit (lib/instance-issuance.ts).
    await ensureInstanceIssued(id);
    return NextResponse.json(
      {
        auditId: id,
        tier,
        status: "awaiting_evidence",
        next: `GET /api/audit/${id}/instance (wallet-signed) → run @solverdict/harness → POST /api/audit/${id}/evidence`,
      },
      { status: 201 },
    );
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

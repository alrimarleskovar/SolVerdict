// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redis, auditKey, QUEUE_KEY, freeUsedKey, FREE_TTL_S, PAYMENT_PENDING_KEY } from "../../../../lib/redis";
import { validateSubmission } from "../../../../lib/submission";
import { assertPublicHttpsUrl, SsrfError } from "../../../../lib/ssrf";
import { PAID_AMOUNT_USDC, USDC_MINT } from "../../../../lib/payment";
import { paymentWallet } from "../../../../lib/payment-flow";
import type { AuditRecord, AuditTier } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max 1 audit per hostname per hour (SSRF/abuse control). */
const RATE_LIMIT_TTL_S = 3600;
const rateKey = (host: string) => `ratelimit:host:${host}`;

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

  // SSRF guard: resolve DNS and reject private/loopback targets BEFORE enqueue.
  let host: string;
  try {
    const target = await assertPublicHttpsUrl(value.endpoint);
    host = target.hostname.toLowerCase();
  } catch (err) {
    if (err instanceof SsrfError) {
      return NextResponse.json({ errors: [`endpoint rejected: ${err.message}`] }, { status: 400 });
    }
    return NextResponse.json({ error: "endpoint validation failed" }, { status: 400 });
  }

  // Rate limit per hostname.
  try {
    const acquired = await redis().set(rateKey(host), new Date().toISOString(), { nx: true, ex: RATE_LIMIT_TTL_S });
    if (acquired === null) {
      return NextResponse.json(
        { errors: [`rate limited: only one audit per hour per host (${host})`] },
        { status: 429 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `rate-limit check failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const base: Omit<AuditRecord, "status" | "n" | "payment"> = {
    id,
    createdAt: now,
    updatedAt: now,
    form: { endpoint: value.endpoint, framework: value.framework, model: value.model, email: value.email },
    protocolConfirmed: value.protocolConfirmed,
    walletPubkey,
    tier,
    result: null,
  };

  if (tier === "free") {
    // One free audit per wallet per 24h (atomic set-if-absent).
    try {
      const acquired = await redis().set(freeUsedKey(walletPubkey), now, { nx: true, ex: FREE_TTL_S });
      if (acquired === null) {
        return NextResponse.json(
          { errors: ["free tier is limited to one audit per wallet per 24h — use the paid tier for another run"] },
          { status: 429 },
        );
      }
    } catch (err) {
      return NextResponse.json({ error: `free-tier check failed: ${String(err)}` }, { status: 502 });
    }

    const record: AuditRecord = { ...base, status: "queued", n: 1 };
    try {
      await redis().set(auditKey(id), record);
      await redis().lpush(QUEUE_KEY, id);
    } catch (err) {
      return NextResponse.json({ error: `Could not queue audit: ${String(err)}` }, { status: 502 });
    }
    return NextResponse.json({ auditId: id, tier, status: "queued" }, { status: 201 });
  }

  // Paid: hold for payment, do NOT enqueue until verified on-chain.
  let destination: string;
  try {
    destination = paymentWallet();
  } catch {
    return NextResponse.json({ error: "payment is not configured on this server" }, { status: 503 });
  }

  const record: AuditRecord = {
    ...base,
    status: "awaiting_payment",
    n: 20,
    payment: { expectedUsdc: PAID_AMOUNT_USDC, destination },
  };
  try {
    await redis().set(auditKey(id), record);
    await redis().lpush(PAYMENT_PENDING_KEY, id);
  } catch (err) {
    return NextResponse.json({ error: `Could not create audit: ${String(err)}` }, { status: 502 });
  }

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

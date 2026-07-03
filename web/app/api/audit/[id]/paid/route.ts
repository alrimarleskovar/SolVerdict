// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { verifyAndQueue } from "../../../../../lib/payment-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client calls this right after sending the USDC payment, with the tx
 * signature. We verify on-chain and, if valid, move the audit to `queued`.
 * A not-yet-valid result (e.g. tx not yet confirmed) returns 202 so the client
 * keeps polling; the cron worker resolves anything left stuck.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id || !/^[0-9a-f-]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid audit id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const signature = (body as { signature?: unknown })?.signature;
  if (typeof signature !== "string" || signature.length < 32 || signature.length > 128) {
    return NextResponse.json({ error: "a payment tx signature is required" }, { status: 400 });
  }

  try {
    const outcome = await verifyAndQueue(id, signature);
    if (outcome.ok) {
      return NextResponse.json({ verified: true, status: outcome.status }, { status: 200 });
    }
    // Not valid yet (or not found) — surface the reason; 202 = keep polling.
    return NextResponse.json({ verified: false, status: outcome.status, reason: outcome.reason }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: `payment verification failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}

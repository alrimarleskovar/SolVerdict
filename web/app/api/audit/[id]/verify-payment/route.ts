// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { resolveStuckPayment } from "../../../../../lib/payment-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal endpoint: re-check a paid audit that has been stuck in
 * `awaiting_payment` past the grace window. Called by the cron worker (and
 * available for manual ops). If still unpaid it marks the audit `payment_failed`
 * and notifies the submitter. No-ops if the audit is not stuck yet.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id || !/^[0-9a-f-]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid audit id" }, { status: 400 });
  }
  try {
    const outcome = await resolveStuckPayment(id);
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: `resolve failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}

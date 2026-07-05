// SPDX-License-Identifier: Apache-2.0
/**
 * GET /api/audits?wallet=<pubkey>&page=<n> — a wallet's audit history for the
 * dashboard, newest first, 20 per page.
 *
 * PRIVACY NOTE: this currently trusts the caller's `wallet` param (pubkeys are
 * public). To make history strictly private to the key holder it needs a signed
 * message proving wallet ownership — flagged for Sprint 7. Only low-sensitivity
 * metadata is returned (no results payload).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet") ?? "";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) | 0);

  if (!BASE58.test(wallet)) {
    return NextResponse.json({ error: "a valid wallet pubkey is required" }, { status: 400 });
  }

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count, error } = await supabaseAdmin()
      .from("audits")
      .select("id, created_at, endpoint, framework, model, tier, status", { count: "exact" })
      .eq("wallet", wallet)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    const audits = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      createdAt: r.created_at,
      endpoint: r.endpoint,
      framework: r.framework,
      model: r.model,
      tier: r.tier,
      status: r.status,
    }));

    const total = typeof count === "number" ? count : audits.length;
    return NextResponse.json(
      { audits, page, pageSize: PAGE_SIZE, total, hasMore: to + 1 < total },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ error: `Lookup failed: ${String(err)}` }, { status: 502 });
  }
}

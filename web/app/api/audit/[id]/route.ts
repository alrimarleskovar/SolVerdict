// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { supabaseAdmin, rowToRecord, type AuditRow } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fresh read on every request. `revalidate = 0` disables the route data cache;
// `fetchCache = "force-no-store"` stops Next from caching supabase-js's internal
// fetch (the actual stale-read culprit — a completed audit was still reported as
// queued because the underlying PostgREST GET was served from Next's fetch cache
// despite force-dynamic). The client itself is created per request (supabaseAdmin).
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Applied to every response so neither the browser nor Vercel's CDN caches the
// audit status (CDN-Cache-Control is what Vercel's edge honours).
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "cdn-cache-control": "no-store",
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id || !/^[0-9a-f-]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid audit id" }, { status: 400, headers: NO_STORE });
  }

  let row: AuditRow | null;
  try {
    const { data, error } = await supabaseAdmin().from("audits").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    row = (data as AuditRow | null) ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: `Lookup failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502, headers: NO_STORE },
    );
  }

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  const record = rowToRecord(row);

  // Wait estimate: count unclaimed audits enqueued ahead of this one.
  if (record.status === "queued") {
    try {
      const { data: q } = await supabaseAdmin()
        .from("queue")
        .select("enqueued_at")
        .eq("audit_id", id)
        .maybeSingle();
      const enqueuedAt = (q as { enqueued_at?: string } | null)?.enqueued_at;
      if (enqueuedAt) {
        const { count, error } = await supabaseAdmin()
          .from("queue")
          .select("audit_id", { count: "exact", head: true })
          .is("claimed_at", null)
          .lt("enqueued_at", enqueuedAt);
        if (!error && typeof count === "number") record.queueDepth = count;
      }
    } catch {
      /* queueDepth is advisory only */
    }
  }

  // `result` is already gated by status: the worker only writes it when done.
  return NextResponse.json(record, { status: 200, headers: NO_STORE });
}

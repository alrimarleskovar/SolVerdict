// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from "next/server";
import { supabaseAdmin, rowToRecord, type AuditRow } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id || !/^[0-9a-f-]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid audit id" }, { status: 400 });
  }

  let row: AuditRow | null;
  try {
    const { data, error } = await supabaseAdmin().from("audits").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    row = (data as AuditRow | null) ?? null;
  } catch (err) {
    return NextResponse.json(
      { error: `Lookup failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  return NextResponse.json(record, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

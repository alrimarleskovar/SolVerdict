// SPDX-License-Identifier: Apache-2.0
/**
 * GET /api/audit/<id>/pdf — stream a single-page PDF report for a completed
 * audit. 404 for unknown ids; 409 if the audit isn't done yet.
 */
import { supabaseAdmin, rowToRecord, type AuditRow } from "../../../../../lib/supabase";
import { buildAuditPdf } from "../../../../../lib/audit-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id || !/^[0-9a-f-]{8,64}$/i.test(id)) {
    return new Response(JSON.stringify({ error: "Invalid audit id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let row: AuditRow | null;
  try {
    const { data, error } = await supabaseAdmin().from("audits").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    row = (data as AuditRow | null) ?? null;
  } catch (err) {
    return new Response(JSON.stringify({ error: `Lookup failed: ${String(err)}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  if (!row) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
  }

  const record = rowToRecord(row);
  if (record.status !== "done" || !record.result) {
    return new Response(JSON.stringify({ error: "Audit is not complete yet" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  const pdf = buildAuditPdf(record.id, record.result, record.createdAt);
  const filename = `solverdict-audit-${record.id.slice(0, 8)}.pdf`;
  return new Response(pdf, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "public, max-age=3600",
    },
  });
}

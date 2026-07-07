// SPDX-License-Identifier: Apache-2.0
/**
 * GET /api/audit/<id>/pdf — stream a single-page PDF report for a completed
 * audit. 404 for unknown ids; 409 if the audit isn't done yet.
 */
import { supabaseAdmin, rowToRecord, type AuditRow } from "../../../../../lib/supabase";
import { buildAuditPdf } from "../../../../../lib/audit-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fresh read every request. Without these, Next caches supabase-js's internal
// fetch and this route reads a STALE row (from when the audit was still queued /
// result null) — which made it 409 on audits that are actually done. Same
// hardening as GET /api/audit/[id].
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Non-done statuses → a clear, honest message (no report to generate). */
const NOT_READY: Record<string, string> = {
  awaiting_payment: "Audit is still running — the report will be available when it completes.",
  queued: "Audit is still running — the report will be available when it completes.",
  running: "Audit is still running — the report will be available when it completes.",
  payment_failed: "This audit's payment did not complete, so no report was generated.",
  failed: "This audit did not complete successfully, so no report is available.",
};

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

  // Only genuinely-unfinished audits are blocked. A DONE audit ALWAYS produces a
  // report — even with zero valid runs (empty scenarios/categories): the user
  // paid and deserves the report, which honestly states "no valid runs".
  if (record.status !== "done") {
    const msg = NOT_READY[record.status] ?? "Audit is not complete yet.";
    return new Response(JSON.stringify({ error: msg }), {
      status: 409,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  if (!record.result) {
    // Defensive: a done audit should always carry a results object; if it's
    // somehow absent, say so clearly rather than crash the PDF builder.
    return new Response(JSON.stringify({ error: "Audit is complete but no result data was recorded." }), {
      status: 422,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
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

// SPDX-License-Identifier: Apache-2.0
/**
 * Dynamic embed badge: GET /api/badge/<id>.svg
 *
 * The `.svg` suffix is part of the URL so the snippet reads naturally in a
 * README; we strip it to recover the audit id. Only a `done` audit yields a
 * result badge — otherwise a neutral "pending" pill. Cached 1h (audits are
 * immutable once done).
 */
import { supabaseAdmin, rowToRecord, type AuditRow } from "../../../../lib/supabase";
import { containmentSummary } from "../../../../lib/placard-model";
import { renderBadgeSvg } from "../../../../lib/badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "image/svg+xml; charset=utf-8",
  "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
};

function svg(body: string): Response {
  return new Response(body, { status: 200, headers: HEADERS });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id.replace(/\.svg$/i, "");
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) {
    return svg(renderBadgeSvg({ contained: 0, scored: 0, total: 14, complete: false, hasRuns: false }));
  }

  let row: AuditRow | null = null;
  try {
    const { data } = await supabaseAdmin().from("audits").select("*").eq("id", id).maybeSingle();
    row = (data as AuditRow | null) ?? null;
  } catch {
    /* fall through to a neutral badge on lookup failure */
  }

  const record = row ? rowToRecord(row) : null;
  if (!record || record.status !== "done" || !record.result) {
    // Neutral pill for not-found / in-progress audits.
    return svg(renderBadgeSvg({ contained: 0, scored: 0, total: 14, complete: false, hasRuns: false }));
  }

  return svg(renderBadgeSvg(containmentSummary(record.result.score)));
}

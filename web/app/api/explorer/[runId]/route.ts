// SPDX-License-Identifier: Apache-2.0
// GET /api/explorer/:runId — one source's setup × scenario score grid.
import { NextResponse } from "next/server";
import { getRunDetail } from "../../../../lib/explorer/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { runId: string } }) {
  try {
    const detail = await getRunDetail(decodeURIComponent(params.runId));
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
}

// SPDX-License-Identifier: Apache-2.0
// GET /api/explorer/:runId/:setupId/:scenarioId — the full scenario bundle
// (all iterations: prompt, response, actions, rpc, txs, verdict, evidence).
// ?download=1 sets a Content-Disposition attachment for one-click export.
import { NextResponse } from "next/server";
import { getScenarioDetail } from "../../../../../../lib/explorer/data";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { runId: string; setupId: string; scenarioId: string } },
) {
  try {
    const detail = await getScenarioDetail(
      decodeURIComponent(params.runId),
      decodeURIComponent(params.setupId),
      decodeURIComponent(params.scenarioId),
    );
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    const res = NextResponse.json(detail);
    if (new URL(req.url).searchParams.get("download") === "1") {
      res.headers.set(
        "Content-Disposition",
        `attachment; filename="solverdict-${params.runId}-${params.setupId}-${params.scenarioId}.json"`,
      );
    }
    return res;
  } catch {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
}

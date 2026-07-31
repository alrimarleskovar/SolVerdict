// SPDX-License-Identifier: Apache-2.0
// GET /api/explorer — list every benchmark source discovered on disk.
import { NextResponse } from "next/server";
import { listSources } from "../../../lib/explorer/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sources: await listSources() });
}

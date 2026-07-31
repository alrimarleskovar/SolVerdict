// SPDX-License-Identifier: Apache-2.0
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRunDetail } from "../../../lib/explorer/data";
import { ExplorerShell } from "../../../components/explorer/Shell";
import { RunExplorer } from "../../../components/explorer/RunExplorer";
import { Badge } from "../../../components/ui/badge";
import { fmtDate } from "../../../components/explorer/status";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { runId: string } }): Metadata {
  return { title: `${decodeURIComponent(params.runId)} — Benchmark Explorer — SolVerdict` };
}

export default async function RunPage({ params }: { params: { runId: string } }) {
  const runId = decodeURIComponent(params.runId);
  let detail;
  try {
    detail = await getRunDetail(runId);
  } catch {
    notFound();
  }
  if (!detail) notFound();

  return (
    <ExplorerShell
      crumbs={[{ label: detail.meta.id }]}
      actions={
        <>
          {detail.meta.official ? <Badge variant="pass">official</Badge> : null}
          <Badge variant={detail.meta.kind === "run" ? "partial" : "outline"}>
            {detail.meta.kind === "run" ? "full run" : "scores only"}
          </Badge>
          <span className="hidden font-mono text-xs text-muted sm:inline">{fmtDate(detail.meta.timestamp)}</span>
        </>
      }
    >
      <Suspense>
        <RunExplorer detail={detail} />
      </Suspense>
    </ExplorerShell>
  );
}

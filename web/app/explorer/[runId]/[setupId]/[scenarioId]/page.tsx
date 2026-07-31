// SPDX-License-Identifier: Apache-2.0
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getScenarioDetail } from "../../../../../lib/explorer/data";
import { scenarioInfo } from "../../../../../lib/explorer/catalog";
import { ExplorerShell } from "../../../../../components/explorer/Shell";
import { ScenarioView } from "../../../../../components/explorer/ScenarioView";

export const dynamic = "force-dynamic";

interface Params {
  runId: string;
  setupId: string;
  scenarioId: string;
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const info = scenarioInfo(decodeURIComponent(params.scenarioId));
  return { title: `${info.id} ${info.title} — ${decodeURIComponent(params.runId)} — SolVerdict` };
}

export default async function ScenarioPage({ params }: { params: Params }) {
  const runId = decodeURIComponent(params.runId);
  const setupId = decodeURIComponent(params.setupId);
  const scenarioId = decodeURIComponent(params.scenarioId);

  let detail;
  try {
    detail = await getScenarioDetail(runId, setupId, scenarioId);
  } catch {
    notFound();
  }
  if (!detail) notFound();

  return (
    <ExplorerShell
      crumbs={[
        { label: runId, href: `/explorer/${encodeURIComponent(runId)}` },
        { label: setupId, href: `/explorer/${encodeURIComponent(runId)}?setup=${encodeURIComponent(setupId)}` },
        { label: scenarioId },
      ]}
    >
      <Suspense>
        <ScenarioView detail={detail} />
      </Suspense>
    </ExplorerShell>
  );
}

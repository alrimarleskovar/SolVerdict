// SPDX-License-Identifier: Apache-2.0
import { Suspense } from "react";
import type { Metadata } from "next";
import { listSources } from "../../lib/explorer/data";
import { ExplorerShell } from "../../components/explorer/Shell";
import { RunsIndex } from "../../components/explorer/RunsIndex";

// Results on disk change between requests (new bench runs) — never prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Benchmark Explorer — SolVerdict",
  description: "Explore every SolVerdict benchmark run: scenarios, prompts, agent responses, timelines and verdicts.",
};

export default async function ExplorerPage() {
  const sources = await listSources();
  return (
    <ExplorerShell crumbs={[]}>
      <Suspense>
        <RunsIndex sources={sources} />
      </Suspense>
    </ExplorerShell>
  );
}

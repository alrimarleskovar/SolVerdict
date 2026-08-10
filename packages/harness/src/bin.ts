#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * `solverdict-run` — drive your agent through the benchmark on your own fork.
 *
 * Your agent module must default-export a SolVerdict `Setup` (which is what
 * @solverdict/sak-adapter builds for you). This produces an evidence bundle and
 * stops there: no verdict is computed locally, because the scoring rules are
 * server-side by design.
 *
 *   solverdict-run --agent ./my-agent.js [--n 20] [--out ./evidence] [--seed 123]
 *                  [--scenarios A2,D1] [--order fixed]
 *                  [--state-dir ./.solverdict]
 *                  [--instance ./instance.json]   (also sets N)
 *                  [--audit <auditId>]
 */
import path from "node:path";
import { readFileSync } from "node:fs";

// Runtime state (the pinned fork slot, the surfnet log) belongs to the CLIENT,
// not to the installed package — see env/surfpool.ts. Set before importing the
// harness: the env modules resolve their paths at module-evaluation time.
const arg0 = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
process.env.SOLVERDICT_STATE_DIR ??= path.resolve(process.cwd(), arg0("--state-dir") ?? ".solverdict");

const { runLocalCampaign } = await import("./runner.js");
type Setup = import("./lib/types.js").Setup;

const arg = arg0;

const agentPath = arg("--agent");
if (!agentPath) {
  console.error("usage: solverdict-run --agent ./my-agent.js [--n N] [--out DIR] [--seed S] [--scenarios A2,D1] [--instance F]");
  process.exit(2);
}

const mod = (await import(path.resolve(process.cwd(), agentPath))) as { default?: Setup };
const setup = mod.default;
if (!setup || typeof setup.run !== "function" || typeof setup.id !== "string") {
  console.error(`${agentPath} must default-export a Setup { id, run(input, wallet, rpcUrl, ctx) }`);
  process.exit(2);
}

// The server issues this file per audit; running without it uses the public
// pre-registered fixtures, which is fine for a rehearsal but is not the
// instance a paid audit is scored on. Read ONCE — the file is the source of
// both the instances and the run count.
const { instanceRunCount } = await import("./lib/instance.js");
const instanceFile = arg("--instance");
const issued = instanceFile
  ? (() => {
      const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), instanceFile), "utf8"));
      return (raw.instances ?? raw) as Record<string, unknown>;
    })()
  : undefined;

/**
 * Runs per scenario: the instance decides, unless you say otherwise.
 *
 * The default used to be the pre-registered N=20 even when the instance covered
 * one run, so following the documented command on a free audit started a
 * 400-cell campaign whose extra 380 cells fell back to public fixtures and were
 * refused on submission. An explicit --n still wins — a rehearsal may
 * legitimately want fewer — but disagreeing with the instance is now said out
 * loud, before the run rather than after it.
 */
const issuedRuns = issued ? instanceRunCount(issued as never) : null;
const flagged = arg("--n") ? Number(arg("--n")) : undefined;
if (flagged !== undefined && issuedRuns !== null && flagged !== issuedRuns) {
  console.warn(
    `[harness] WARNING: --n ${flagged} disagrees with the instance, which covers ${issuedRuns} run(s) per scenario.\n` +
      `[harness]          Cells outside the issued range fall back to PUBLIC fixtures and the submission will be` +
      ` refused.\n[harness]          Drop --n to use ${issuedRuns}.`,
  );
} else if (flagged === undefined && issuedRuns !== null) {
  console.log(`[harness] N=${issuedRuns} per scenario, from the issued instance`);
}

const summary = await runLocalCampaign({
  setup,
  outDir: path.resolve(process.cwd(), arg("--out") ?? "evidence"),
  n: flagged ?? issuedRuns ?? undefined,
  seed: arg("--seed") ? Number(arg("--seed")) : undefined,
  order: arg("--order") === "fixed" ? "fixed" : "random",
  scenarioIds: arg("--scenarios")?.split(",").map((s) => s.trim()),
  issued: issued as never,
});

const { packageSubmission } = await import("./submission.js");
const packed = packageSubmission({ runDir: summary.outDir, auditId: arg("--audit") ?? null });

console.log(`\nEvidence bundle: ${packed.bundlePath}`);
console.log(`Manifest:        ${packed.manifestPath}`);
console.log(`Manifest sha256: ${packed.manifestSha256}`);
console.log(
  `\nSign that digest with the wallet that owns the audit and POST the archive,\n` +
    `the manifest and the signature to /api/audit/<id>/evidence.\n` +
    `This machine did not compute a verdict — scoring happens server-side.`,
);

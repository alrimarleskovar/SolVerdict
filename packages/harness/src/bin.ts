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
 *                  [--instance ./instance.json]
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

const summary = await runLocalCampaign({
  setup,
  outDir: path.resolve(process.cwd(), arg("--out") ?? "evidence"),
  n: arg("--n") ? Number(arg("--n")) : undefined,
  seed: arg("--seed") ? Number(arg("--seed")) : undefined,
  order: arg("--order") === "fixed" ? "fixed" : "random",
  scenarioIds: arg("--scenarios")?.split(",").map((s) => s.trim()),
  // The server issues this file per audit; running without it uses the public
  // pre-registered fixtures, which is fine for a rehearsal but is not the
  // instance a paid audit is scored on.
  issued: arg("--instance")
    ? (JSON.parse(readFileSync(path.resolve(process.cwd(), arg("--instance")!), "utf8")).instances ??
       JSON.parse(readFileSync(path.resolve(process.cwd(), arg("--instance")!), "utf8")))
    : undefined,
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

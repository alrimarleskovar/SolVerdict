// SPDX-License-Identifier: Apache-2.0
/**
 * THE SERVER HALF of the local-adapter model: score a bundle a client submitted.
 *
 * `scripts/rescore-bundle.ts` re-scores one of OUR OWN runs and diffs it against
 * a published snapshot — that proved the verdict is reproducible from evidence.
 * This one scores a submission that has no snapshot to diff against, which is
 * the case the SaaS actually faces, and is the entry point the worker wraps.
 *
 * Usage: tsx scripts/score-submission.ts <bundle-dir> [--n N]
 *
 * WHAT THE SERVER TRUSTS FROM THE CLIENT, AND WHAT IT DOES NOT.
 * Trusted: the raw evidence bytes (signed txs with their validator metadata,
 * RPC transcript, action log, the instance params the scenario setup produced).
 * Not trusted: any magnitude the client computed (step 3 — the server re-derives
 * outflow from `meta.preBalances`/`postBalances` and from `rawBase64`), and the
 * denominator. `plannedRuns` comes from the PRE-REGISTERED N, never from the
 * bundle's own `run-metadata.json`: a client that could declare its own N could
 * submit its five best runs and call the cell complete. Short submissions score
 * as incomplete, which is the intended outcome, not an error.
 *
 * `--n` overrides the denominator for smoke bundles and marks the result
 * UNOFFICIAL, mirroring how `bench.ts --n` marks its own runs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SCENARIOS } from "../scenarios/index.js";
import { applicabilityOf } from "../config/capabilities.js";
import { N_RUNS } from "../config/params.js";
import { PREREG } from "../config/prereg.js";
import { rescoreBundle } from "../scoring/rescore.js";

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(root)) throw new Error("usage: score-submission.ts <bundle-dir> [--n N]");

const nFlag = process.argv.indexOf("--n");
const plannedRuns = nFlag > 0 ? Number(process.argv[nFlag + 1]) : N_RUNS;
const official = plannedRuns === N_RUNS;

const metaPath = path.join(root, "run-metadata.json");
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};

const checks = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.check]));
const categoryOf = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.category]));

const { scores, runs, rederivation, mismatches } = rescoreBundle(root, {
  checks,
  categoryOf,
  plannedRuns,
  notApplicable: (setupId, scenarioId) => applicabilityOf(setupId, scenarioId).notApplicable,
  // No ctxOverride: a bundle from @solverdict/harness always carries ctx.json.
  // A submission that needs the legacy shim is a submission we did not produce.
});

console.log(`\nsubmission ${meta.runId ?? path.basename(root)}`);
console.log(`  produced by      ${meta.producedBy ?? "(unknown)"} — prereg ${meta.preregVersion ?? "(unstated)"}` +
  (meta.preregVersion && meta.preregVersion !== PREREG.version ? `  ** MISMATCH: server is on ${PREREG.version} **` : ""));
console.log(`  execution        order=${meta.execution?.order ?? "?"} seed=${meta.execution?.seed ?? "?"} forkSlot=${meta.forkSlot ?? "?"}`);
console.log(`  runs read        ${runs.length}  (denominator N=${plannedRuns}${official ? "" : " — UNOFFICIAL override"})`);
const totalTx = rederivation.rederived + rederivation.decodeOnly + rederivation.legacyAsserted;
console.log(
  `  magnitude        ${rederivation.rederived}/${totalTx} txs re-derived server-side` +
    ` (decode-only: ${rederivation.decodeOnly}; client-asserted: ${rederivation.legacyAsserted})`,
);
if (rederivation.legacyAsserted > 0) console.log(`  ** ${rederivation.legacyAsserted} tx(s) fell back to a client-asserted magnitude **`);
if (mismatches.length > 0) console.log(`  ** ${mismatches.length} run(s) disagree with a verdict the client shipped **`);

for (const [setupId, score] of scores) {
  console.log(`\n${setupId}`);
  for (const s of score.scenarios) {
    if (s.applicable === false) {
      console.log(`  ${s.scenarioId.padEnd(4)} n/a          ${s.notApplicable?.reason ?? ""}`);
      continue;
    }
    const rate = s.rate === null ? "  —  " : `${(s.rate * 100).toFixed(1)}%`.padStart(6);
    const ci = s.ci ? ` [${(s.ci.low * 100).toFixed(0)}-${(s.ci.high * 100).toFixed(0)}]` : "";
    console.log(
      `  ${s.scenarioId.padEnd(4)} ${rate}${ci.padEnd(10)} ${String(s.attempted)}/${s.planned} attempted` +
        `${s.excluded ? `, ${s.excluded} excluded` : ""}${s.complete ? "" : "  INCOMPLETE"}`,
    );
  }
  for (const c of score.categories) {
    const mean = c.meanRate === null ? "—" : `${(c.meanRate * 100).toFixed(1)}%`;
    console.log(`  category ${c.category}: ${mean} (${c.tier ?? "tier suppressed"})`);
  }
  const c = score.completeness;
  console.log(
    `  COMPLETE ${c.complete}` +
      ` — ${c.scenariosScored}/${c.scenariosPlanned} applicable scenarios scored` +
      (c.missingScenarios.length ? `, missing: ${c.missingScenarios.join(",")}` : "") +
      (c.partialScenarios?.length ? `, partial: ${c.partialScenarios.join(",")}` : ""),
  );
}

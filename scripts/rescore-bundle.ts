// SPDX-License-Identifier: Apache-2.0
/**
 * THE STEP-2 PROOF: re-score a committed evidence bundle server-side and
 * compare the result to the published snapshot.
 *
 * Usage: tsx scripts/rescore-bundle.ts <runId> <results-OFFICIAL-*.json>
 *
 * If the re-scored `setups[].score` is byte-identical to the published one, the
 * whole local-adapter premise holds: the verdict can be produced on our
 * hardware from evidence alone, so the client never needs scoring/.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCENARIOS } from "../scenarios/index.js";
import { applicabilityOf } from "../config/capabilities.js";
import { N_RUNS } from "../config/params.js";
import { reconstructCtx } from "../lib/legacy-ctx.js";
import { rescoreBundle } from "../scoring/rescore.js";
import type { ScenarioContext } from "../lib/types.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const runId = process.argv[2];
const officialPath = process.argv[3];
if (!runId || !officialPath) throw new Error("usage: rescore-bundle.ts <runId> <results-OFFICIAL-*.json>");

// --- extract the bundle ------------------------------------------------------
// A packaged bundle, or an un-packaged run tree under runs/ (dev / smoke).
const bundle = path.join(ROOT, "runs/evidence", `${runId}.tar.gz`);
const packaged = existsSync(bundle);
const work = packaged ? mkdtempSync(path.join(tmpdir(), "rescore-")) : "";
if (packaged) execSync(`tar -xzf ${JSON.stringify(bundle)} -C ${JSON.stringify(work)}`);
const root = packaged ? path.join(work, runId) : path.join(ROOT, "runs", runId);

// --- legacy ctx: bundles written before ctx.json ----------------------------
// Pre-resolved because rescoreBundle is synchronous and setup() is async.
const ctxCache = new Map<string, ScenarioContext | undefined>();
{
  const { readdirSync, statSync } = await import("node:fs");
  const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((e) => statSync(path.join(p, e)).isDirectory()) : []);
  for (const s of dirs(root))
    for (const sc of dirs(path.join(root, s)))
      for (const n of dirs(path.join(root, s, sc))) {
        const dir = path.join(root, s, sc, n);
        if (existsSync(path.join(dir, "ctx.json"))) continue; // current bundles need no shim
        const input = JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8"));
        ctxCache.set(dir, await reconstructCtx(sc, input));
      }
}

// The snapshot records the N its campaign committed to; use that rather than
// the prereg default, so a smoke run (--n 2) compares against its own plan.
const officialEarly = JSON.parse(readFileSync(path.join(ROOT, "report", path.basename(officialPath)), "utf8"));
const plannedRuns: number =
  officialEarly.setups?.[0]?.score?.scenarios?.find((x: { applicable?: boolean; planned?: number }) => x.applicable !== false)
    ?.planned ?? N_RUNS;

const checks = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.check]));
const categoryOf = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.category]));

const { scores, runs, mismatches, rederivation } = rescoreBundle(root, {
  checks,
  categoryOf,
  plannedRuns,
  notApplicable: (setupId, scenarioId) => applicabilityOf(setupId, scenarioId).notApplicable,
  // Per RUN DIRECTORY: each run has its own mint / slot pair.
  ctxOverride: (_scenarioId, _input, dir) => ctxCache.get(dir),
});

// --- compare against the published snapshot ---------------------------------
const official = officialEarly;
const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

console.log(`\nre-scored ${runs.length} runs from ${runId}`);
const totalTx = rederivation.rederived + rederivation.decodeOnly + rederivation.legacyAsserted;
console.log(
  `magnitude re-derived server-side: ${rederivation.rederived}/${totalTx} txs` +
    ` (decode-only, no meta: ${rederivation.decodeOnly}; legacy client-asserted balance: ${rederivation.legacyAsserted})`,
);
console.log(`per-run verdict/outcome mismatches vs recorded: ${mismatches.length}`);
for (const m of mismatches.slice(0, 10)) {
  console.log(`  ${m.cell} ${m.field}: recorded=${canon(m.recorded).slice(0, 90)} rescored=${canon(m.rescored).slice(0, 90)}`);
}

let differing = 0;
console.log("\nper-setup aggregate vs published snapshot:");
for (const s of official.setups) {
  const got = scores.get(s.setupId);
  const same = got !== undefined && canon(got) === canon(s.score);
  if (!same) differing++;
  console.log(`  ${same ? "IDENTICAL" : "DIFFERS  "}  ${s.setupId}`);
  if (!same && got) {
    for (const cat of s.score.categories) {
      const g = got.categories.find((c) => c.category === cat.category);
      if (canon(g) !== canon(cat)) console.log(`      ${cat.category}: published=${canon(cat).slice(0, 120)}\n         rescored=${canon(g).slice(0, 120)}`);
    }
  }
}

if (packaged) rmSync(work, { recursive: true, force: true });
if (differing === 0 && mismatches.length === 0) {
  console.log("\n✅ BYTE-IDENTICAL — server-side re-scoring reproduces the published verdict exactly.");
} else {
  console.log(`\n❌ ${differing} setup(s) differ, ${mismatches.length} per-run mismatch(es).`);
  process.exitCode = 1;
}

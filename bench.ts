// SPDX-License-Identifier: Apache-2.0
/**
 * `npm run bench` — runs every selected setup against every scenario, N times
 * each, against the local Surfpool fork; scores each run by its objective
 * prereg-§6 rule; aggregates contained-rates + Wilson 95% CIs + category means
 * (prereg §4); writes report/results.json and the static leaderboard.
 *
 * Determinism / reproducibility: a pinned fork slot (config/forkslot.json),
 * ephemeral wallets funded via cheatcodes, full per-run logs under runs/.
 * Agent variance is the only non-determinism (prereg §4) — hence N=20.
 *
 * Flags:
 *   --setups a,b,c   restrict to setups by id (default: all published setups)
 *   --scenarios A1,. restrict to scenarios by id (default: all 14)
 *   --n N            runs per scenario (default N_RUNS=20). Any value != 20
 *                    marks results UNOFFICIAL.
 */
import { Keypair } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import { N_RUNS } from "./config/params.js";
import { SCENARIOS } from "./scenarios/index.js";
import { SETUPS, SELFTEST_SETUPS, getSetup } from "./setups/index.js";
import { scoreSetup, classifyOutcome, type RunRecord } from "./scoring/index.js";
import {
  ensureSurfpool,
  startRecorder,
  stopRecorder,
  beginRun,
  endRun,
  parseRun,
  fundStandardWallet,
  makeEnvHandle,
  readPinnedForkSlot,
  RPC_URL,
} from "./env/index.js";
import type { RunLogs, Setup } from "./lib/types.js";
import { generateReport, type ResultsFile } from "./report/generate.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const RUNS_DIR = path.join(ROOT, "runs");
const RESULTS_PATH = path.join(ROOT, "report", "results.json");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function jsonReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

function writeRunLog(setupId: string, scenarioId: string, n: number, data: unknown): void {
  const dir = path.join(RUNS_DIR, setupId, scenarioId, String(n));
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, jsonReplacer, 2));
  }
}

async function main(): Promise<void> {
  const nRuns = arg("--n") ? Number(arg("--n")) : N_RUNS;
  const official = nRuns === N_RUNS;

  const setupFilter = arg("--setups")?.split(",").map((s) => s.trim());
  const scenFilter = arg("--scenarios")?.split(",").map((s) => s.trim());

  let setups: Setup[];
  if (setupFilter) {
    setups = setupFilter.map((id) => getSetup(id)).filter((s): s is Setup => !!s);
  } else {
    setups = SETUPS;
  }
  const scenarios = scenFilter ? SCENARIOS.filter((s) => scenFilter.includes(s.id)) : SCENARIOS;

  console.log(`[bench] starting Surfpool…`);
  await ensureSurfpool();
  await startRecorder();
  const forkSlot = readPinnedForkSlot();
  console.log(`[bench] fork slot ${forkSlot}; ${setups.length} setup(s) x ${scenarios.length} scenario(s) x N=${nRuns}${official ? "" : "  (UNOFFICIAL — N != 20)"}`);

  const records: RunRecord[] = [];
  const setupSettings = new Map<string, Record<string, unknown>>();

  // Per (setup, scenario) run accounting. Errored/invalid runs (the agent
  // never executed) are tallied here and EXCLUDED from `records` so they are
  // never scored as contained. The report surfaces them as incomplete / n=0.
  interface ScenarioCounts {
    attempted: number;
    valid: number;
    errored: number;
    /** Valid runs classified intent-dangerous-exec-failed (counted NOT contained). */
    intentDangerous: number;
    /** Contained runs carrying a data-quality flag (unexplained tool error). */
    dataQualityFlags: number;
    sampleError?: string;
  }
  const runCounts = new Map<string, Map<string, ScenarioCounts>>(); // setupId -> scenarioId -> counts
  const attemptedSetups = new Set<string>();
  const countsFor = (setupId: string, scenarioId: string): ScenarioCounts => {
    let bySc = runCounts.get(setupId);
    if (!bySc) {
      bySc = new Map();
      runCounts.set(setupId, bySc);
    }
    let c = bySc.get(scenarioId);
    if (!c) {
      c = { attempted: 0, valid: 0, errored: 0, intentDangerous: 0, dataQualityFlags: 0 };
      bySc.set(scenarioId, c);
    }
    return c;
  };

  for (const setup of setups) {
    if (setup.status === "not-yet-integrated") {
      console.log(`[bench] skipping ${setup.id} (not-yet-integrated)`);
      continue;
    }
    attemptedSetups.add(setup.id);
    for (const scenario of scenarios) {
      for (let n = 0; n < nRuns; n++) {
        const counts = countsFor(setup.id, scenario.id);
        counts.attempted++;
        const wallet = Keypair.generate(); // ephemeral, in-memory, per run
        const env = makeEnvHandle(wallet.publicKey.toBase58());
        await fundStandardWallet(env.walletAddress);
        const ctx = await scenario.setup(env);
        const input = scenario.trigger(ctx);

        beginRun();
        let runResult;
        let thrown: string | null = null;
        try {
          runResult = await setup.run(input, wallet, RPC_URL, ctx);
        } catch (err) {
          thrown = String(err).slice(0, 200);
        }
        const recording = endRun();

        // ERRORED / INVALID RUN: the agent never executed (threw, or reported
        // ok=false because every model turn failed). Record it as errored,
        // EXCLUDE from N, and never score it as contained — an infrastructure
        // failure is not a safety pass.
        if (thrown !== null || !runResult || runResult.ok === false) {
          const reason = thrown ?? runResult?.error ?? "agent did not execute (zero successful model turns)";
          counts.errored++;
          counts.sampleError ??= reason;
          if (runResult) setupSettings.set(setup.id, runResult.settings);
          writeRunLog(setup.id, scenario.id, n, {
            input,
            error: { reason, modelTurns: runResult?.modelTurns ?? 0 },
            actions: runResult?.actions ?? [],
            finalText: runResult?.finalText ?? `[run errored: ${reason}]`,
            excludedFromScoring: true,
          });
          continue;
        }

        const txs = await parseRun(recording.sends, env.walletAddress);
        const logs: RunLogs = { txs, actions: runResult.actions, rpc: recording.rpc };

        const verdict = scenario.check(logs, ctx);
        // Refine the binary PASS/FAIL into the three-outcome taxonomy (§6
        // amendment): a contained-by-check run where the agent actually
        // attempted the dangerous action (tool failed before submission) is
        // intent-dangerous-exec-failed, NOT a safety pass.
        const ro = classifyOutcome(scenario.id, logs, ctx, verdict);
        counts.valid++;
        if (ro.outcome === "intent-dangerous-exec-failed") counts.intentDangerous++;
        if (ro.dataQuality) counts.dataQualityFlags++;
        records.push({
          setupId: setup.id,
          scenarioId: scenario.id,
          category: scenario.category,
          runIndex: n,
          verdict,
          outcome: ro.outcome,
        });
        setupSettings.set(setup.id, runResult.settings);

        writeRunLog(setup.id, scenario.id, n, {
          input,
          actions: logs.actions,
          txs: logs.txs,
          rpc: logs.rpc,
          verdict,
          outcome: ro.outcome,
          intentEvidence: ro.intentEvidence,
          dataQuality: ro.dataQuality ?? null,
          finalText: runResult.finalText,
          settings: runResult.settings,
        });
      }
      const c = countsFor(setup.id, scenario.id);
      const so = scoreSetup(setup.id, records).scenarios.find((s) => s.scenarioId === scenario.id);
      if (c.valid === 0) {
        console.log(`[bench]   ${setup.id}/${scenario.id}: INCOMPLETE — 0/${c.attempted} valid (${c.errored} errored: ${c.sampleError ?? "?"})`);
      } else {
        const rate = so ? `${(so.rate * 100).toFixed(0)}%` : "n/a";
        const errNote = c.errored > 0 ? `, ${c.errored} errored/excluded` : "";
        const intentNote = c.intentDangerous > 0 ? `, ${c.intentDangerous} intent-dangerous-exec-failed` : "";
        const dqNote = c.dataQualityFlags > 0 ? `, ⚠️ ${c.dataQualityFlags} data-quality flag(s)` : "";
        console.log(`[bench]   ${setup.id}/${scenario.id}: contained ${so?.contained ?? 0}/${c.valid} (${rate})${intentNote}${errNote}${dqNote}`);
      }
    }
  }

  await stopRecorder();

  const results: ResultsFile = {
    meta: {
      benchmark: "Tripwire",
      preregFile: "tripwire-prereg-v0.md",
      preregVersion: "v0.1",
      generatedAt: new Date().toISOString(),
      forkSlot,
      nRunsDefault: N_RUNS,
      official,
      versions: { surfpool: "1.3.1", "solana-web3.js": "1.98.4", node: process.version },
    },
    // Include every ATTEMPTED setup — even one whose runs all errored — so an
    // all-failed setup surfaces as incomplete / n=0 instead of silently
    // vanishing from the board.
    setups: setups
      .filter((s) => attemptedSetups.has(s.id))
      .map((s) => {
        const bySc = runCounts.get(s.id) ?? new Map<string, ScenarioCounts>();
        const byScenario: Record<string, ScenarioCounts> = {};
        let attempted = 0;
        let valid = 0;
        let errored = 0;
        let incomplete = false;
        for (const [scenarioId, c] of bySc) {
          byScenario[scenarioId] = c;
          attempted += c.attempted;
          valid += c.valid;
          errored += c.errored;
          if (c.valid < c.attempted || c.valid === 0) incomplete = true;
        }
        return {
          setupId: s.id,
          status: s.status,
          settings: setupSettings.get(s.id) ?? {},
          score: scoreSetup(s.id, records), // built from VALID runs only
          runCounts: { attempted, valid, errored, byScenario },
          incomplete,
        };
      }),
  };

  mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(results, jsonReplacer, 2));
  console.log(`[bench] wrote ${RESULTS_PATH}`);
  generateReport();
  console.log(`[bench] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

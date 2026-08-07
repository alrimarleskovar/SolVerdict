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
 * EXECUTION ORDER (audit SVD-009). Runs are NOT executed in nested-loop order.
 * The whole campaign is expanded into one flat list of (setup, scenario, run)
 * cells and shuffled with a recorded seed, because fixed order confounds
 * carry-over with position and makes budget exhaustion kill the same trailing
 * scenarios every time (Run B lost sak+claude D2/E1-E3 exactly that way). The
 * seed, the fingerprint and the full resolved order are written into the run
 * tree — see runs/<runId>/run-metadata.json (`execution`) and run-order.json.
 *
 * Flags:
 *   --setups a,b,c   restrict to setups by id (default: all published setups)
 *   --scenarios A1,. restrict to scenarios by id (default: all 20)
 *   --n N            runs per scenario (default N_RUNS=20). Any value != 20
 *                    marks results UNOFFICIAL.
 *   --seed S         execution-order seed (decimal or 0xHEX). Default: random,
 *                    always recorded. Re-running with the same seed AND the
 *                    same setup/scenario/n selection reproduces the order.
 *   --order fixed    legacy nested-loop order — debugging only, and it marks
 *                    results UNOFFICIAL (an official board must be randomised).
 */
import { Keypair } from "@solana/web3.js";
import { mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { packageEvidence } from "./lib/evidence.js";
import { addUsage, emptyUsage } from "./lib/metrics.js";
import {
  buildRunPlan,
  cellKey,
  makeSeed,
  parseSeed,
  type ExecutionOrder,
} from "./lib/schedule.js";
import {
  classifyFailure,
  summarizeMissingness,
  type FailurePhase,
  type MissingRun,
} from "./lib/missingness.js";
import { evaluateOfficiality } from "./lib/officiality.js";
import { certifyPrereg } from "./lib/prereg.js";
import path from "node:path";
import "dotenv/config";
import { N_RUNS } from "./config/params.js";
import { PREREG } from "./config/prereg.js";
import { SCENARIOS } from "./scenarios/index.js";
import { CORE_SETUP_IDS } from "./config/roster.js";
import { applicabilityOf } from "./config/capabilities.js";
import { SHARED_FIXTURE_ADDRESSES } from "./scenarios/fixtures.js";
import {
  scoreSetup,
  classifyOutcome,
  type RunRecord,
  type ScenarioPlan,
  type SetupScore,
} from "./scoring/index.js";
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
  probeState,
  resetToBaseline,
  takeOrphanTraffic,
  awaitRecorderIdle,
  type StateSnapshot,
  RPC_URL,
} from "./env/index.js";
import type { RpcCallEntry, RunLogs, RunTiming, Setup, SubmittedTx, TokenUsage } from "./lib/types.js";
import type { RawSend } from "./env/recorder.js";
import { generateReport, type ResultsFile } from "./report/generate.js";

/**
 * Setups are loaded LAZILY (dynamic import), never eagerly. Importing every
 * setup at module load (as `./setups/index.js` does) pulls in the SAK modules,
 * which evaluate the `@pump-fun/pump-sdk` ESM bundle just by being imported —
 * so a run that only uses `selftest-scripted` would still crash if that bundle
 * has issues. Keyed by setup id (which uses "+"); the file names use "-".
 */
const SETUP_LOADERS: Record<string, () => Promise<{ default: Setup }>> = {
  "baseline-scripted": () => import("./setups/baseline-scripted.js"),
  "model-only-claude": () => import("./setups/model-only-claude.js"),
  "sak+claude": () => import("./setups/sak-claude.js"),
  "sak+gpt": () => import("./setups/sak-gpt.js"),
  "sak+claude+onlyfence": () => import("./setups/sak-claude-onlyfence.js"),
  "eliza+claude": () => import("./setups/eliza-claude.js"),
  "rig+claude": () => import("./setups/rig-claude.js"),
  "selftest-scripted": () => import("./setups/selftest-scripted.js"),
  // SMOKE-ONLY (prereg v0.3.0 §7) — loadable by explicit --setups only, and
  // deliberately absent from PUBLISHED_SETUP_IDS so no default run can pick
  // them up and no official result can ever be produced from them.
  "model-only-gemini": () => import("./setups/model-only-gemini.js"),
  "sak+gemini": () => import("./setups/sak-gemini.js"),
};

/** Published board order (prereg §7) — the default when no --setups is given.
 *  Excludes the harness self-test (`selftest-scripted`). */
const PUBLISHED_SETUP_IDS = [
  "baseline-scripted",
  "model-only-claude",
  "sak+claude",
  "sak+gpt",
  "sak+claude+onlyfence",
  "eliza+claude",
  "rig+claude",
];

/** Load only the requested setups (or the published set by default). */
async function loadSetups(ids: string[]): Promise<Setup[]> {
  const setups: Setup[] = [];
  for (const id of ids) {
    const load = SETUP_LOADERS[id];
    if (!load) {
      console.warn(`[bench] unknown setup id "${id}" — skipping`);
      continue;
    }
    setups.push((await load()).default);
  }
  return setups;
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const RUNS_DIR = path.join(ROOT, "runs");
const RESULTS_PATH = path.join(ROOT, "report", "results.json");

/**
 * Per-invocation log root: runs/<runId>/ (official) or runs/smoke/ (dev). Set
 * once at the top of main() so each bench invocation produces a self-contained,
 * immutable log tree instead of overwriting the previous run's per-run logs
 * (see docs/investigations/run-b-quality-audit.md §7-8). Defaults to RUNS_DIR
 * only as a safety fallback; main() always reassigns it.
 */
let RUN_ROOT = RUNS_DIR;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function jsonReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

/** UTC, sortable, filesystem-safe run id — e.g. `2026-06-19T143005Z`. */
function makeRunId(): string {
  return new Date().toISOString().slice(0, 19).replace(/:/g, "") + "Z";
}

/** Current git commit, or null if git is unavailable / not a repo. */
function gitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Point runs/latest at the just-written run. A symlink is best-effort (some
 * filesystems disallow it); runs/latest.txt is always written so development
 * workflows can resolve the most recent run without a runId.
 */
function updateLatestPointer(runDirName: string): void {
  const link = path.join(RUNS_DIR, "latest");
  try {
    unlinkSync(link);
  } catch {
    /* no existing symlink/file to replace */
  }
  try {
    symlinkSync(runDirName, link, "dir");
  } catch {
    /* symlinks may be unsupported on this platform — latest.txt still covers it */
  }
  writeFileSync(path.join(RUNS_DIR, "latest.txt"), runDirName + "\n");
}

function writeRunLog(setupId: string, scenarioId: string, n: number, data: unknown): void {
  const dir = path.join(RUN_ROOT, setupId, scenarioId, String(n));
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, jsonReplacer, 2));
  }
}


// --- cost / performance instrumentation -------------------------------------
//
// Raw measurements only: tokens and milliseconds. No dollar conversion happens
// in the harness — prices move independently of the data, so pricing at capture
// time would silently date every recorded run. Applied downstream instead.

interface RunMetrics {
  setupId: string;
  scenarioId: string;
  runIndex: number;
  modelTurns: number;
  usage: TokenUsage | null;
  timing: {
    phases: { forkSetupMs: number; agentMs: number; scoringMs: number };
    agent: RunTiming | null;
  };
}

const collectedMetrics: RunMetrics[] = [];
function collectMetrics(m: RunMetrics): void {
  collectedMetrics.push(m);
}

interface MetricsRollup {
  runs: number;
  modelTurns: number;
  usage: TokenUsage;
  phases: { forkSetupMs: number; agentMs: number; scoringMs: number };
  agent: { runMs: number; toolMs: number; llmWaitMs: number; chainSubmitMs: number; toolCalls: number };
  /** "blended" if ANY contributing run could not isolate chain time. */
  toolBreakdown: "split" | "blended" | "n/a";
}

function emptyRollup(): MetricsRollup {
  return {
    runs: 0,
    modelTurns: 0,
    usage: emptyUsage(),
    phases: { forkSetupMs: 0, agentMs: 0, scoringMs: 0 },
    agent: { runMs: 0, toolMs: 0, llmWaitMs: 0, chainSubmitMs: 0, toolCalls: 0 },
    toolBreakdown: "n/a",
  };
}

function addToRollup(r: MetricsRollup, m: RunMetrics): void {
  r.runs++;
  r.modelTurns += m.modelTurns;
  if (m.usage) addUsage(r.usage, m.usage);
  r.phases.forkSetupMs += m.timing.phases.forkSetupMs;
  r.phases.agentMs += m.timing.phases.agentMs;
  r.phases.scoringMs += m.timing.phases.scoringMs;
  const a = m.timing.agent;
  if (a) {
    r.agent.runMs += a.runMs;
    r.agent.toolMs += a.toolMs;
    r.agent.llmWaitMs += a.llmWaitMs;
    r.agent.chainSubmitMs += a.chainSubmitMs ?? 0;
    r.agent.toolCalls += a.toolCalls;
    // Degrade to "blended" if any run in the group was blended: a rollup must
    // never claim a cleaner split than its least-resolved contributor.
    r.toolBreakdown = r.toolBreakdown === "blended" || a.toolBreakdown === "blended" ? "blended" : "split";
  }
}

/** Per-audit totals + per (setup, scenario) breakdown for run-metadata.json. */
function rollupMetrics(): Record<string, unknown> {
  const totals = emptyRollup();
  const bySetup: Record<string, MetricsRollup> = {};
  const byScenario: Record<string, MetricsRollup> = {};
  for (const m of collectedMetrics) {
    addToRollup(totals, m);
    addToRollup((bySetup[m.setupId] ??= emptyRollup()), m);
    addToRollup((byScenario[`${m.setupId}/${m.scenarioId}`] ??= emptyRollup()), m);
  }
  return { totals, bySetup, byScenario };
}

async function main(): Promise<void> {
  const nRuns = arg("--n") ? Number(arg("--n")) : N_RUNS;
  const orderFlag = arg("--order") ?? "random";
  if (orderFlag !== "random" && orderFlag !== "fixed") {
    throw new Error(`--order must be "random" or "fixed" (got "${orderFlag}")`);
  }
  const order: ExecutionOrder = orderFlag;

  // Execution-order seed. Explicit --seed / BENCH_SEED reproduces a previous
  // campaign's order; otherwise one is drawn and recorded. A malformed seed is
  // fatal rather than silently replaced — a run that thinks it is reproducing
  // an order but is not would be worse than no run at all.
  const rawSeed = arg("--seed") ?? process.env.BENCH_SEED;
  const parsedSeed = parseSeed(rawSeed);
  if (rawSeed !== undefined && rawSeed !== "" && parsedSeed === null) {
    throw new Error(`[bench] --seed "${rawSeed}" is not a uint32 (decimal or 0xHEX)`);
  }
  const seed = parsedSeed ?? makeSeed();

  const setupFilter = arg("--setups")?.split(",").map((s) => s.trim());
  const scenFilter = arg("--scenarios")?.split(",").map((s) => s.trim());

  // Lazily import ONLY the requested setups (default: the published board),
  // so a smoke run never evaluates SAK / @pump-fun/pump-sdk.
  const setups = await loadSetups(setupFilter ?? PUBLISHED_SETUP_IDS);
  const scenarios = scenFilter ? SCENARIOS.filter((s) => scenFilter.includes(s.id)) : SCENARIOS;

  // Setups that cannot run are dropped BEFORE planning, so the plan describes
  // the work actually attempted and the seed maps onto exactly that work.
  const runnableSetups = setups.filter((s) => {
    if (s.status === "not-yet-integrated") {
      console.log(`[bench] skipping ${s.id} (not-yet-integrated)`);
      return false;
    }
    return true;
  });
  const setupById = new Map(runnableSetups.map((s) => [s.id, s]));
  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));

  /**
   * NOT-APPLICABLE cells are dropped from the plan entirely (prereg §6,
   * Emenda 7). A cell whose dangerous action the setup cannot express has no
   * choice to measure, so executing it would spend real credits to observe an
   * agent declining to use a tool it does not have.
   *
   * They are still reported — `scoreSetup` receives them as declared n/a plan
   * entries below, and they render as `n/a` with the capability reason. What
   * is skipped is the execution, not the disclosure.
   */
  const naByScenario = new Map<string, { capability: string; reason: string }>();
  const naCells: string[] = [];
  for (const setup of runnableSetups) {
    for (const scenario of scenarios) {
      const a = applicabilityOf(setup.id, scenario.id);
      if (!a.applicable && a.notApplicable) {
        naByScenario.set(`${setup.id}/${scenario.id}`, a.notApplicable);
        naCells.push(`${setup.id}/${scenario.id}`);
      }
    }
  }

  const plan = buildRunPlan({
    setupIds: runnableSetups.map((s) => s.id),
    scenarioIds: scenarios.map((s) => s.id),
    n: nRuns,
    seed,
    order,
    // The seed still reproduces the order: the skip set is derived from a
    // committed table, so the same selection always yields the same plan.
    skip: (setupId, scenarioId) => naByScenario.has(`${setupId}/${scenarioId}`),
  });
  if (naCells.length > 0) {
    console.log(
      `[bench] NOT-APPLICABLE: ${naCells.length} cell(s) skipped by capability declaration ` +
        `(config/capabilities.ts) — ${naCells.join(", ")}`,
    );
    console.log(`[bench]   these are reported as n/a, are NOT counted contained, and do NOT enter N.`);
  }

  /**
   * Officiality, part 1 of 2 (audit SVD-007).
   *
   * Four of the five prereg gates are CONFIGURATION facts, knowable now: full
   * N, randomised order, the §7 core roster present, the §6 rubric planned.
   * The fifth — every core cell actually scored at full N — is only knowable
   * once the campaign is in, so it is evaluated again at the end.
   *
   * Passing an empty completeness map here makes the `core-complete` check
   * vacuous by construction, so this verdict is exactly "is this campaign
   * ELIGIBLE to be official", never "is it official".
   */
  const eligibility = evaluateOfficiality({
    nRuns,
    requiredRuns: N_RUNS,
    order,
    coreSetupIds: CORE_SETUP_IDS,
    setupsRun: runnableSetups.map((s) => s.id),
    requiredScenarioIds: SCENARIOS.map((s) => s.id),
    scenariosPlanned: scenarios.map((s) => s.id),
    completeness: {},
  });
  const officialEligible = eligibility.official;

  // Resolve the run id. Priority: explicit --run-id / BENCH_RUN_ID, else a
  // sortable UTC timestamp for official (N=20) runs, else the shared "smoke"
  // bucket for dev/unofficial runs (overwritten each turn so it never pollutes
  // the immutable per-run history).
  const explicitRunId = (arg("--run-id") ?? process.env.BENCH_RUN_ID)?.trim();
  const runId = explicitRunId || (officialEligible ? makeRunId() : "smoke");
  RUN_ROOT = path.join(RUNS_DIR, runId);
  if (runId === "smoke") rmSync(RUN_ROOT, { recursive: true, force: true });
  mkdirSync(RUN_ROOT, { recursive: true });
  const startTime = new Date().toISOString();
  console.log(`[bench] runId = ${runId}  →  runs/${runId}/`);

  console.log(`[bench] starting Surfpool…`);
  await ensureSurfpool();
  await startRecorder();
  const forkSlot = readPinnedForkSlot();
  console.log(
    `[bench] fork slot ${forkSlot}; ${runnableSetups.length} setup(s) x ${scenarios.length} scenario(s) x N=${nRuns}` +
      ` = ${plan.cells.length} runs${officialEligible ? "" : `  (UNOFFICIAL — ${eligibility.failures.join("; ")})`}`,
  );
  if (officialEligible) {
    console.log(
      `[bench] officiality: config gates pass — final verdict depends on completeness ` +
        `(prereg §7 requires every core cell at N=${N_RUNS}); evaluated after the campaign.`,
    );
  }
  console.log(`[bench] execution order: ${order}, seed ${seed} (0x${seed.toString(16)}), ${plan.fingerprint}`);

  // The resolved order, verbatim. The seed alone would already replay it, but
  // an auditor should not have to trust that — they can diff this file against
  // their own re-run instead of re-deriving it from the PRNG.
  const reproduceCmd =
    `npm run bench -- --seed ${seed} --n ${nRuns}` +
    ` --setups ${runnableSetups.map((s) => s.id).join(",")}` +
    ` --scenarios ${scenarios.map((s) => s.id).join(",")}`;
  writeFileSync(
    path.join(RUN_ROOT, "run-order.json"),
    JSON.stringify(
      {
        runId,
        order,
        seed,
        seedHex: `0x${seed.toString(16)}`,
        rng: "mulberry32 + Fisher-Yates (lib/schedule.ts)",
        fingerprint: plan.fingerprint,
        plannedRuns: plan.cells.length,
        reproduce: reproduceCmd,
        note:
          "Position i in `sequence` executed i-th. The seed reproduces this order only " +
          "for the same setup/scenario/n selection, in the same listed order.",
        sequence: plan.cells.map(cellKey),
      },
      null,
      2,
    ),
  );

  // Pre-campaign baseline for every address SHARED across runs (scenario
  // fixtures + allow/deny lists). Each run is restored to this before it starts,
  // so run 37 begins in the same fork state run 1 did (see env/state-reset.ts).
  const stateBaseline: StateSnapshot = await probeState(SHARED_FIXTURE_ADDRESSES);
  // Every tracked address is a synthetic throwaway pubkey with no mainnet
  // history (scenarios/fixtures.ts), so anything holding a balance at CAPTURE
  // time is residue from an EARLIER campaign on this same long-lived fork.
  // Runs within this campaign are still mutually independent — they all start
  // from this same baseline — but the baseline is not pristine, and an official
  // run should start from a fresh Surfpool so it is.
  const dirtyAtBaseline = Object.entries(stateBaseline)
    .filter(([, s]) => s.lamports !== null || s.usdc !== null)
    .map(([address]) => address);
  if (dirtyAtBaseline.length > 0) {
    console.warn(
      `[bench] NOTE: ${dirtyAtBaseline.length}/${SHARED_FIXTURE_ADDRESSES.length} shared fixture address(es) already ` +
        `hold state on this fork — residue from an earlier campaign. Every run of THIS campaign is reset to that same ` +
        `baseline, so they stay comparable, but for a pristine baseline restart Surfpool before an official run.`,
    );
  }
  writeFileSync(
    path.join(RUN_ROOT, "state-baseline.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        addresses: SHARED_FIXTURE_ADDRESSES.length,
        dirtyAtCapture: dirtyAtBaseline,
        baseline: stateBaseline,
      },
      null,
      2,
    ),
  );

  // Self-contained provenance for this run tree. Re-written at the end with
  // endTime + the model settings actually observed per setup.
  const runMetadata: Record<string, unknown> = {
    runId,
    startTime,
    // PROVISIONAL: config gates only. Overwritten at the end with the real
    // verdict, which also requires every core cell to have scored at full N.
    officialEligible,
    official: false,
    officiality: { stage: "pre-campaign", ...eligibility },
    preregVersion: PREREG.version,
    // Self-certification (D3): the exact bytes of the methodology this run was
    // scored under. An edit to the document after the run produces a different
    // digest than the archived run claims.
    prereg: certifyPrereg(ROOT),
    forkSlot,
    n: nRuns,
    setups: runnableSetups.map((s) => s.id),
    scenarios: scenarios.map((s) => s.id),
    // SVD-009: execution order is part of the method, so it is provenance.
    execution: {
      order,
      seed,
      seedHex: `0x${seed.toString(16)}`,
      rng: "mulberry32 + Fisher-Yates (lib/schedule.ts)",
      planFingerprint: plan.fingerprint,
      plannedRuns: plan.cells.length,
      orderFile: "run-order.json",
      stateBaselineFile: "state-baseline.json",
      baseline: { trackedAddresses: SHARED_FIXTURE_ADDRESSES.length, dirtyAtCapture: dirtyAtBaseline.length },
      reproduce: reproduceCmd,
    },
    versions: { surfpool: "1.3.1", "solana-web3.js": "1.98.4", node: process.version },
    gitCommit: gitCommit(),
  };
  writeFileSync(path.join(RUN_ROOT, "run-metadata.json"), JSON.stringify(runMetadata, null, 2));

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
    /**
     * Why the errored runs errored, by declared class (lib/missingness.ts).
     * An incomplete cell must say WHETHER it ran out of credits or hit a
     * harness fault — the two mean very different things for the board.
     */
    classifications?: Record<string, number>;
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

  /**
   * Every run excluded from N, with the reason class that caused it. An
   * incomplete cell must be visible AND explained — "2 runs lost to exhausted
   * credits" is a different claim from "2 runs lost to a wedged fork".
   */
  const missing: MissingRun[] = [];
  const recordMissing = (
    cell: { setupId: string; scenarioId: string; runIndex: number },
    executionPosition: number,
    phase: FailurePhase,
    reason: string,
  ): void => {
    const classification = classifyFailure(reason, phase);
    missing.push({ ...cell, executionPosition, phase, classification, reason, at: new Date().toISOString() });
    const counts = countsFor(cell.setupId, cell.scenarioId);
    counts.classifications = counts.classifications ?? {};
    counts.classifications[classification] = (counts.classifications[classification] ?? 0) + 1;
  };

  /** Aggregate evidence that runs did NOT bleed into each other (SVD-009 part 2). */
  const carryOver = {
    runsWithOrphanRpc: 0,
    orphanRpcCalls: 0,
    orphanSends: 0,
    recorderIdleTimeouts: 0,
    runsWithStateResidue: 0,
    stateFieldsRestored: 0,
    irreversibleFields: 0,
    /** First few concrete instances, so the number is auditable. */
    samples: [] as unknown[],
  };

  // ONE flat, seeded-shuffled pass over the whole campaign (SVD-009). Every
  // run is a fresh (setup, scenario, runIndex) triple drawn from `plan.cells`;
  // nothing about a run depends on its neighbours any more.
  for (const [i, cell] of plan.cells.entries()) {
    const position = i + 1;
    const setup = setupById.get(cell.setupId)!;
    const scenario = scenarioById.get(cell.scenarioId)!;
    const n = cell.runIndex;
    attemptedSetups.add(setup.id);
    const counts = countsFor(setup.id, scenario.id);
    counts.attempted++;
    console.log(`[bench] (${position}/${plan.cells.length}) ${setup.id}/${scenario.id} run ${n}`);
    /**
     * Whatever the recorder captured for THIS run, hoisted out of the try so
     * the crash handler can still reach it (D2).
     *
     * A crash after `endRun()` — in decoding, in `check()`, in classification —
     * leaves the recording already claimed. Calling `endRun()` again from the
     * catch throws, so without this the sends of a run that crashed while being
     * SCORED would be lost, which is exactly the run whose evidence matters.
     */
    let captured: { sends: RawSend[]; rpc: RpcCallEntry[] } | null = null;
    // Per-run safety net: NO single run may abort the whole bench. Any
    // failure in this run's lifecycle — funding, scenario setup, the agent,
    // parsing, or scoring — is recorded as errored + EXCLUDED from N, and
    // the loop moves on. funding.ts already retries setAccount and restarts
    // a dead Surfpool; this catch covers anything that still slips through
    // (e.g. Surfpool wedged past the funding retries). An infra failure is
    // never scored as a safety pass.
    try {
      // PHASE 0 — independence: restore the shared fixture addresses to their
      // pre-campaign baseline, so this run starts in the fork state run 1 saw.
      // Whatever had to be restored is residue from an earlier run and is
      // recorded rather than quietly wiped.
      const stateReset = await resetToBaseline(SHARED_FIXTURE_ADDRESSES, stateBaseline);
      if (stateReset.deltas.length > 0) {
        carryOver.runsWithStateResidue++;
        carryOver.stateFieldsRestored += stateReset.restored;
        carryOver.irreversibleFields += stateReset.irreversible.length;
        if (carryOver.samples.length < 10) {
          carryOver.samples.push({ position, cell: cellKey(cell), kind: "fork-state", deltas: stateReset.deltas.slice(0, 5) });
        }
      }

      const wallet = Keypair.generate(); // ephemeral, in-memory, per run
      const env = makeEnvHandle(wallet.publicKey.toBase58());
      // PHASE 1 — fork setup: cheatcode funding + scenario fixture build
      // (for category F this creates real Token-2022 mints on the fork).
      const forkSetupStartedAt = Date.now();
      await fundStandardWallet(env.walletAddress);
      const ctx = await scenario.setup(env);
      const forkSetupMs = Date.now() - forkSetupStartedAt;
      const input = scenario.trigger(ctx);

      // Recorder handover: wait for the proxy to go quiet, then claim whatever
      // arrived while no run owned it. All harness traffic uses the internal
      // port, so anything counted here is a straggler from the PREVIOUS run —
      // the one class of state that could contaminate this run's evidence.
      const idle = await awaitRecorderIdle();
      const orphan = takeOrphanTraffic();
      if (idle.timedOut) carryOver.recorderIdleTimeouts++;
      if (orphan.rpcCalls > 0) {
        carryOver.runsWithOrphanRpc++;
        carryOver.orphanRpcCalls += orphan.rpcCalls;
        carryOver.orphanSends += orphan.sends;
        console.warn(
          `[bench]   carry-over: ${orphan.rpcCalls} RPC call(s) (${orphan.sends} sendTransaction) arrived ` +
            `between runs, before ${cellKey(cell)} — excluded from this run's evidence`,
        );
        if (carryOver.samples.length < 10) {
          carryOver.samples.push({ position, cell: cellKey(cell), kind: "recorder", orphan });
        }
      }

      // PHASE 2 — agent: model loop + tool execution. The setup reports its
      // own internal split (tool vs model wait) in runResult.timing.
      beginRun();
      const agentStartedAt = Date.now();
      let runResult;
      let thrown: string | null = null;
      try {
        runResult = await setup.run(input, wallet, RPC_URL, ctx);
      } catch (err) {
        thrown = String(err).slice(0, 200);
      }
      const agentMs = Date.now() - agentStartedAt;
      const recording = endRun();
      captured = recording;

      const execution = {
        position,
        of: plan.cells.length,
        order,
        seed,
        stateReset: { checked: stateReset.checked, restored: stateReset.restored, deltas: stateReset.deltas, irreversible: stateReset.irreversible },
        recorderHandover: { idleWaitMs: idle.waitedMs, idleTimedOut: idle.timedOut, orphanTraffic: orphan },
      };

      // ERRORED / INVALID RUN: the agent never executed (threw, or reported
      // ok=false because every model turn failed). Record it as errored,
      // EXCLUDE from N, and never score it as contained — an infrastructure
      // failure is not a safety pass.
      //
      // An exclusion must NEVER discard captured on-chain evidence (D2). The
      // recorder observed whatever this run submitted before it failed, and a
      // framework whose agent loop aborts mid-run can leave real transactions
      // behind it. Those sends are decoded and written out exactly as a scored
      // run's are — they simply do not count toward N. Dropping them, as this
      // branch used to, meant a run that drained the wallet and then threw left
      // no trace of the drain in the evidence bundle.
      if (thrown !== null || !runResult || runResult.ok === false) {
        const reason = thrown ?? runResult?.error ?? "agent did not execute (zero successful model turns)";
        counts.errored++;
        counts.sampleError ??= reason;
        recordMissing(cell, position, "agent", reason);
        if (runResult) setupSettings.set(setup.id, runResult.settings);
        let excludedTxs: SubmittedTx[] = [];
        try {
          excludedTxs = await parseRun(recording.sends, env.walletAddress);
        } catch (err) {
          console.warn(`[bench]   ${cellKey(cell)}: could not decode ${recording.sends.length} send(s) of the excluded run: ${String(err).slice(0, 120)}`);
        }
        const submittedNote =
          excludedTxs.length > 0
            ? ` — WARNING: ${excludedTxs.length} transaction(s) were submitted before the failure and are PRESERVED in the run log (unscored)`
            : "";
        console.log(
          `[bench]   ${cellKey(cell)}: EXCLUDED (${classifyFailure(reason, "agent")}) — ${reason}${submittedNote}`,
        );
        writeRunLog(setup.id, scenario.id, n, {
          execution,
          input,
          error: { reason, phase: "agent", classification: classifyFailure(reason, "agent"), modelTurns: runResult?.modelTurns ?? 0 },
          actions: runResult?.actions ?? [],
          // Captured evidence, kept verbatim. Unscored, never silently lost.
          txs: excludedTxs,
          rpc: recording.rpc,
          finalText: runResult?.finalText ?? `[run errored: ${reason}]`,
          excludedFromScoring: true,
        });
        continue;
      }

      // PHASE 3 — scoring: decode + cross-check evidence, then classify.
      const scoringStartedAt = Date.now();
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

      const runMetrics = {
        setupId: setup.id,
        scenarioId: scenario.id,
        runIndex: n,
        modelTurns: runResult.modelTurns ?? 0,
        // Raw counts only — no pricing anywhere in the harness (see lib/metrics.ts).
        usage: runResult.usage ?? null,
        timing: {
          phases: { forkSetupMs, agentMs, scoringMs: Date.now() - scoringStartedAt },
          agent: runResult.timing ?? null,
        },
      };
      collectMetrics(runMetrics);

      writeRunLog(setup.id, scenario.id, n, {
        execution,
        metrics: runMetrics,
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
    } catch (err) {
      // Unexpected mid-run failure (state reset/funding/Surfpool/parse/scoring).
      // Reset the recorder if a throw happened mid-recording, record the run as
      // errored + excluded, and continue — never abort the bench.
      // Same rule as the agent-phase exclusion (D2): whatever the recorder
      // already captured is kept. A crash in scoring or state-reset must not
      // erase transactions the agent really submitted.
      //
      // `captured` is already set when the crash happened AFTER endRun() (i.e.
      // during decode/check/classify); only an earlier crash leaves the
      // recorder still active, and only then is there a recording to claim.
      if (!captured) {
        try {
          captured = endRun();
        } catch {
          /* recorder already inactive — nothing was captured to preserve */
        }
      }
      const reason = `run crashed: ${String(err).slice(0, 200)}`;
      counts.errored++;
      counts.sampleError ??= reason;
      recordMissing(cell, position, "lifecycle", reason);
      console.log(`[bench]   ${cellKey(cell)}: EXCLUDED (${classifyFailure(reason, "lifecycle")}) — ${reason}`);
      try {
        // Raw wire sends: decoding needs the wallet address, which may itself
        // be what failed, so the bytes are preserved verbatim rather than parsed.
        writeRunLog(setup.id, scenario.id, n, {
          execution: { position, of: plan.cells.length, order, seed },
          error: { reason, phase: "lifecycle", classification: classifyFailure(reason, "lifecycle") },
          rawSends: captured?.sends ?? [],
          rpc: captured?.rpc ?? [],
          excludedFromScoring: true,
        });
      } catch {
        /* never let logging abort the bench */
      }
    }
  }

  // Late stragglers: anything still arriving after the last run is bleed too,
  // and is counted rather than dropped.
  const tailIdle = await awaitRecorderIdle();
  const tailOrphan = takeOrphanTraffic();
  if (tailIdle.timedOut) carryOver.recorderIdleTimeouts++;
  if (tailOrphan.rpcCalls > 0) {
    carryOver.runsWithOrphanRpc++;
    carryOver.orphanRpcCalls += tailOrphan.rpcCalls;
    carryOver.orphanSends += tailOrphan.sends;
    carryOver.samples.push({ position: plan.cells.length, cell: "(after last run)", kind: "recorder", orphan: tailOrphan });
  }
  await stopRecorder();

  /**
   * The scoring PLAN, per setup (audit SVD-007).
   *
   * `plannedRuns` comes from the campaign plan — NOT from the records that
   * survived — because that is the denominator the board must be honest about.
   * A scenario whose every run errored has `plannedRuns: 20, valid: 0`, and
   * scoring now emits a row for it instead of dropping it out of its category
   * mean.
   */
  const plannedPerCell = new Map<string, number>();
  for (const cell of plan.cells) {
    const key = `${cell.setupId}/${cell.scenarioId}`;
    plannedPerCell.set(key, (plannedPerCell.get(key) ?? 0) + 1);
  }
  const planFor = (setupId: string): ScenarioPlan[] =>
    scenarios.map((scenario) => {
      // Declared not-applicable: no runs were planned, and none may be scored.
      const na = naByScenario.get(`${setupId}/${scenario.id}`);
      if (na) {
        return {
          scenarioId: scenario.id,
          category: scenario.category,
          plannedRuns: 0,
          attemptedRuns: 0,
          notApplicable: na,
        };
      }
      const c = countsFor(setupId, scenario.id);
      return {
        scenarioId: scenario.id,
        category: scenario.category,
        plannedRuns: plannedPerCell.get(`${setupId}/${scenario.id}`) ?? 0,
        attemptedRuns: c.attempted,
        excludedByClass: c.classifications ?? {},
      };
    });

  // Scored once per setup and reused — the old code re-scored the whole
  // campaign inside a nested per-cell loop.
  const scores = new Map<string, SetupScore>();
  for (const setup of runnableSetups) {
    scores.set(setup.id, scoreSetup(setup.id, records, planFor(setup.id)));
  }

  // Per-cell summary, printed once at the end: with a shuffled order a cell's
  // runs are no longer contiguous, so there is no mid-loop moment at which a
  // cell is complete.
  for (const setup of runnableSetups) {
    const score = scores.get(setup.id)!;
    for (const scenario of scenarios) {
      const c = countsFor(setup.id, scenario.id);
      const so = score.scenarios.find((s) => s.scenarioId === scenario.id);
      const classes = c.classifications
        ? ` [${Object.entries(c.classifications).map(([k, v]) => `${v} ${k}`).join(", ")}]`
        : "";
      if (so && !so.applicable) {
        console.log(
          `[bench]   ${setup.id}/${scenario.id}: n/a — ${so.notApplicable?.capability} capability absent (not scored, not in N)`,
        );
      } else if (!so || so.n === 0) {
        console.log(`[bench]   ${setup.id}/${scenario.id}: INCOMPLETE — 0/${c.attempted} valid (${c.errored} errored${classes}: ${c.sampleError ?? "?"})`);
      } else {
        const rate = so.rate !== null ? `${(so.rate * 100).toFixed(0)}%` : "n/a";
        // N_valid vs N_planned, always — never just "n".
        const nNote = `${so.contained}/${so.n} of ${so.planned} planned`;
        const errNote = so.excluded > 0 ? `, ${so.excluded} excluded${classes}` : "";
        const intentNote = c.intentDangerous > 0 ? `, ${c.intentDangerous} intent-dangerous-exec-failed` : "";
        const dqNote = c.dataQualityFlags > 0 ? `, ⚠️ ${c.dataQualityFlags} data-quality flag(s)` : "";
        console.log(`[bench]   ${setup.id}/${scenario.id}: contained ${nNote} (${rate})${intentNote}${errNote}${dqNote}`);
      }
    }
    const comp = score.completeness;
    if (!comp.complete) {
      console.warn(
        `[bench] ${setup.id}: INCOMPLETE — ${comp.validRuns}/${comp.plannedRuns} runs scored; ` +
          `${comp.missingScenarios.length} scenario(s) with no valid run` +
          `${comp.missingScenarios.length ? ` (${comp.missingScenarios.join(", ")})` : ""}, ` +
          `${comp.partialScenarios.length} short of N` +
          `${comp.partialScenarios.length ? ` (${comp.partialScenarios.join(", ")})` : ""}`,
      );
      for (const cat of score.categories) {
        if (cat.tier === null && cat.meanRate !== null) {
          console.warn(
            `[bench]   category ${cat.category}: NO TIER — mean ${(cat.meanRate * 100).toFixed(1)}% is over ` +
              `${cat.scoredScenarios.length}/${cat.scenarios.length} scenarios (missing: ${cat.missingScenarios.join(", ")}). ` +
              `A mean over a short roster describes a different scenario population.`,
          );
        }
      }
    }
  }

  const missingness = summarizeMissingness(missing);
  if (missingness.excluded > 0) {
    const byClass = Object.entries(missingness.byClassification).map(([k, v]) => `${v} ${k}`).join(", ");
    console.warn(`[bench] MISSINGNESS: ${missingness.excluded}/${plan.cells.length} run(s) excluded from N — ${byClass}`);
    if (missingness.budgetTruncation) {
      console.warn(
        `[bench] WARNING: some exclusions are budget failures (credits/rate limit). ` +
          `Randomised order spreads these across cells instead of truncating the last ones, ` +
          `but the affected cells are still short of N and MUST be disclosed as incomplete.`,
      );
    }
  }
  if (carryOver.orphanRpcCalls > 0 || carryOver.runsWithStateResidue > 0) {
    console.warn(
      `[bench] CARRY-OVER observed: ${carryOver.orphanRpcCalls} inter-run RPC call(s) over ` +
        `${carryOver.runsWithOrphanRpc} handover(s); fork-state residue restored before ` +
        `${carryOver.runsWithStateResidue} run(s) (${carryOver.stateFieldsRestored} field(s)).`,
    );
  }

  /**
   * Officiality, part 2 of 2 (audit SVD-007): the same gate, now with the
   * completeness the campaign actually produced. This is the verdict that
   * ships. Run B would have failed `core-complete` here — sak+claude was
   * missing 4 scenarios and 95 runs — instead of carrying `official: true`.
   */
  const officiality = evaluateOfficiality({
    nRuns,
    requiredRuns: N_RUNS,
    order,
    coreSetupIds: CORE_SETUP_IDS,
    setupsRun: runnableSetups.map((s) => s.id),
    requiredScenarioIds: SCENARIOS.map((s) => s.id),
    scenariosPlanned: scenarios.map((s) => s.id),
    completeness: Object.fromEntries(
      [...scores].map(([id, sc]) => [id, sc.completeness]),
    ),
  });
  const official = officiality.official;
  if (!official) {
    console.warn(`[bench] NOT OFFICIAL — ${officiality.failures.join("; ")}`);
  } else {
    console.log(`[bench] OFFICIAL — every prereg gate passed (§4 N=${N_RUNS}, §6 rubric, §7 core roster complete).`);
  }

  const results: ResultsFile = {
    meta: {
      benchmark: "SolVerdict",
      preregFile: PREREG.file,
      preregVersion: PREREG.version,
      preregSha256: certifyPrereg(ROOT).sha256,
      generatedAt: new Date().toISOString(),
      forkSlot,
      nRunsDefault: N_RUNS,
      official,
      // Every gate with its verdict, so "why is this unofficial?" is always
      // answerable from the snapshot itself.
      officiality: { checks: officiality.checks, failures: officiality.failures },
      // Execution order travels WITH the published snapshot, not just with the
      // run tree: a results-OFFICIAL-*.json must be replayable on its own.
      execution: { order, seed, planFingerprint: plan.fingerprint, plannedRuns: plan.cells.length },
      missingness: {
        excluded: missingness.excluded,
        byClassification: missingness.byClassification,
        budgetTruncation: missingness.budgetTruncation,
      },
      versions: { surfpool: "1.3.1", "solana-web3.js": "1.98.4", node: process.version },
    },
    // Include every ATTEMPTED setup — even one whose runs all errored — so an
    // all-failed setup surfaces as incomplete / n=0 instead of silently
    // vanishing from the board.
    setups: runnableSetups
      .filter((s) => attemptedSetups.has(s.id))
      .map((s) => {
        const bySc = runCounts.get(s.id) ?? new Map<string, ScenarioCounts>();
        const byScenario: Record<string, ScenarioCounts> = {};
        let attempted = 0;
        let valid = 0;
        let errored = 0;
        for (const [scenarioId, c] of bySc) {
          byScenario[scenarioId] = c;
          attempted += c.attempted;
          valid += c.valid;
          errored += c.errored;
        }
        // `incomplete` now comes from the score's own completeness rollup
        // rather than being recomputed here, so the flag and the numbers it
        // describes can never disagree.
        const score = scores.get(s.id)!;
        return {
          setupId: s.id,
          status: s.status,
          settings: setupSettings.get(s.id) ?? {},
          score, // rates over VALID runs; completeness markers carried alongside
          runCounts: { attempted, valid, errored, byScenario },
          incomplete: !score.completeness.complete,
        };
      }),
  };

  mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(results, jsonReplacer, 2));
  console.log(`[bench] wrote ${RESULTS_PATH}`);
  const reportStartedAt = Date.now();
  generateReport();
  const reportMs = Date.now() - reportStartedAt;

  // Finalize the run tree: complete metadata (end time + model settings actually
  // used) and point runs/latest at it. report/results.json + index.html remain
  // the latest-run summary (overwritten by design); runs/<runId>/ is immutable.
  runMetadata.endTime = new Date().toISOString();
  runMetadata.modelSettings = Object.fromEntries(setupSettings);
  // Replace the provisional pre-campaign verdict with the real one.
  runMetadata.official = official;
  runMetadata.officiality = { stage: "final", ...officiality };
  runMetadata.completeness = Object.fromEntries([...scores].map(([id, sc]) => [id, sc.completeness]));
  // SVD-009: what was planned vs. what actually produced a scored run, why the
  // difference, and the measured evidence that runs did not bleed into each
  // other. All of it ships inside the evidence bundle.
  (runMetadata.execution as Record<string, unknown>).executedRuns = plan.cells.length - missingness.excluded;
  (runMetadata.execution as Record<string, unknown>).missingness = missingness;
  (runMetadata.execution as Record<string, unknown>).carryOver = carryOver;
  // Measured cost/perf for the whole audit, so an official run carries its own
  // token and timing data inside the evidence bundle (Step C).
  runMetadata.metrics = { ...rollupMetrics(), reportMs };
  writeFileSync(path.join(RUN_ROOT, "run-metadata.json"), JSON.stringify(runMetadata, null, 2));
  updateLatestPointer(runId);
  // Bundle on ELIGIBILITY, not on the final verdict (D4). The campaign that
  // fell short of the gate is precisely the one whose evidence is needed — to
  // diagnose the loss and decide about a re-run — and it already has a
  // timestamped immutable run tree. Gating on `official` meant a 1599/1600
  // campaign silently produced no bundle at all.
  if (officialEligible) packageRunEvidence(runId, runMetadata, results);
  console.log(`[bench] runId = ${runId}  (immutable logs under runs/${runId}/, runs/latest → ${runId})`);
  console.log(`[bench] done.`);
}

/**
 * Bundle an OFFICIAL run's per-run evidence into runs/evidence/ so the result
 * stays auditable after the working tree is regenerated or discarded.
 *
 * Run B's transcripts were never committed, so when a scoring defect surfaced
 * later its blast radius on the published numbers could not be measured without
 * re-running paid setups. Aggregate snapshots record counts; only the per-run
 * action log can answer "did this contained run attempt something dangerous?".
 *
 * Unofficial runs are never bundled — scratch must not enter history. A failure
 * here warns and never fails the run: the scoring is already written, and losing
 * a bundle must not discard a completed official run.
 */
function packageRunEvidence(runId: string, metadata: Record<string, unknown>, results: ResultsFile): void {
  try {
    const { bytes } = packageEvidence({
      runsDir: RUNS_DIR,
      runId,
      metadata,
      perCell: results.setups.map((s) => ({ setupId: s.setupId, runCounts: s.runCounts, incomplete: s.incomplete })),
    });
    console.log(`[bench] evidence bundle -> runs/evidence/${runId}.tar.gz (${(bytes / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(
      `[bench] WARNING: could not package evidence for ${runId} (${String(err).slice(0, 160)}). ` +
        `The run tree is intact at runs/${runId}/ — bundle it manually before discarding it.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

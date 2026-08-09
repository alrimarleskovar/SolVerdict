// SPDX-License-Identifier: Apache-2.0
/**
 * @solverdict/harness — the CLIENT half of the benchmark.
 *
 * WHAT THIS PACKAGE IS FOR. In the local-adapter model the audit runs on the
 * client's machine (their agent, their fork, their `localhost:8899`), and only
 * the EVIDENCE travels. This package is everything needed to produce that
 * evidence, and deliberately nothing more.
 *
 * WHAT IS NOT HERE, AND WHY:
 *   scenarios/checks/      the PASS/FAIL rules
 *   config/thresholds.ts   the caps those rules compare against
 *   scoring/               outcome classification and aggregation
 *
 * All three stay server-side. A client that can read the rule can optimise
 * against it, and a client that can compute the verdict can forge it — the
 * whole point of re-scoring server-side from raw evidence is that neither is
 * possible. `scripts/check-harness-isolation.mjs` walks this package's import
 * graph on every CI run and fails if any of them becomes reachable.
 *
 * The sources under `src/` are VENDORED copies of the in-repo modules, so the
 * package is self-contained and publishable. `scripts/check-harness-drift.mjs`
 * asserts each copy is byte-identical to its origin, so the duplication cannot
 * silently diverge.
 */

// --- the local campaign loop (evidence only, no verdict) ---------------------
export { runLocalCampaign, type LocalRunOptions, type LocalRunSummary } from "./runner.js";

// --- fork orchestration ------------------------------------------------------
export {
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
  RPC_URL,
  type StateSnapshot,
} from "./env/index.js";

// --- the scenario instances (client halves only) -----------------------------
export { SCENARIO_CLIENTS, CATEGORY_NAMES } from "./scenarios/clients.js";
export { FIXTURES, ALLOWLIST, ALLOWLIST_LABELS, DENYLIST, SHARED_FIXTURE_ADDRESSES } from "./scenarios/fixtures.js";

// --- shared contracts --------------------------------------------------------
export type {
  ActionLogEntry,
  AgentInput,
  Category,
  CheckVerdict,
  EnvHandle,
  ParsedInstruction,
  RpcCallEntry,
  RunLogs,
  ScenarioClient,
  ScenarioContext,
  SubmittedTx,
  Setup,
  SetupRunResult,
  ToolOverlay,
} from "./lib/types.js";

// --- campaign mechanics ------------------------------------------------------
export { buildRunPlan, cellKey, planFingerprint, makeSeed, parseSeed, shuffled, mulberry32, type RunCell, type RunPlan, type ExecutionOrder } from "./lib/schedule.js";
export { classifyFailure, summarizeMissingness, type FailureClass, type FailurePhase, type MissingRun, type MissingnessSummary } from "./lib/missingness.js";

// --- client-safe parameters --------------------------------------------------
// NOTE: config/params.ts only. config/thresholds.ts (CAPS/TIERS/WILSON_Z) is the
// answer key and must never appear in this list.
export {
  LAMPORTS_PER_SOL,
  STANDARD_WALLET,
  USDC_MINT,
  USDC_DECIMALS,
  N_RUNS,
  DISCLOSED_DAILY_CAP_SOL,
  MAX_AGENT_STEPS,
  MAX_TOKENS,
} from "./config/params.js";
export { PREREG } from "./config/prereg.js";

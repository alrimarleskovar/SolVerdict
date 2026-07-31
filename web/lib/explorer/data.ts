// SPDX-License-Identifier: Apache-2.0
/**
 * Server-only data layer for the Benchmark Explorer.
 *
 * Two automatic sources, no configuration needed:
 *  - runs/<runId>/…            — full per-iteration transcripts written by
 *    `npm run bench` (prompt, actions, txs, rpc, verdict…). Gitignored, so
 *    normally present only where the bench actually ran.
 *  - report/results*.json      — committed aggregate score reports (meta +
 *    per-setup scenario scores). Scores only, no transcripts.
 *
 * SOLVERDICT_DATA_ROOT overrides the repo root when the web app is deployed
 * away from the bench checkout.
 */
import { promises as fs } from "fs";
import path from "path";
import type {
  IterationBundle,
  Outcome,
  RunDetail,
  RunSourceMeta,
  ScenarioCellSummary,
  ScenarioDetail,
  SetupSummary,
} from "./types";

// "+" appears in real setup ids (sak+claude, sak+gpt); it is path-safe.
const ID_RE = /^[A-Za-z0-9.+_-]+$/;

/** Reject anything that could escape the runs/report directories. */
function safeId(id: string): string {
  if (!ID_RE.test(id) || id.includes("..")) throw new Error(`invalid id: ${id}`);
  return id;
}

async function repoRoot(): Promise<string> {
  if (process.env.SOLVERDICT_DATA_ROOT) return process.env.SOLVERDICT_DATA_ROOT;
  // web/ lives inside the repo; in dev/start the cwd is web/.
  for (const cand of [path.resolve(process.cwd(), ".."), process.cwd()]) {
    try {
      await fs.access(path.join(cand, "report"));
      return cand;
    } catch {
      /* try next */
    }
  }
  return path.resolve(process.cwd(), "..");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Aggregate report files (report/results*.json)
// ---------------------------------------------------------------------------

interface ReportScenarioScore {
  scenarioId: string;
  n: number;
  contained: number;
  uncontained: number;
  intentDangerousExecFailed: number;
  errored?: number;
  rate: number | null;
  ci?: { low: number; high: number };
  tier?: string;
}

interface ReportFile {
  meta?: {
    preregVersion?: string;
    generatedAt?: string;
    official?: boolean;
    nRunsDefault?: number;
    versions?: Record<string, string>;
  };
  setups?: Array<{
    setupId: string;
    status?: string;
    settings?: Record<string, unknown>;
    score?: { scenarios?: ReportScenarioScore[] };
  }>;
}

function reportMeta(id: string, r: ReportFile): RunSourceMeta {
  const setups = (r.setups ?? []).map((s) => s.setupId);
  const scenarios = [
    ...new Set((r.setups ?? []).flatMap((s) => (s.score?.scenarios ?? []).map((sc) => sc.scenarioId))),
  ].sort();
  return {
    kind: "report",
    id,
    label: id.replace(/^results-?/, "") || "results",
    official: Boolean(r.meta?.official),
    preregVersion: r.meta?.preregVersion,
    timestamp: r.meta?.generatedAt,
    setups,
    scenarios,
    n: r.meta?.nRunsDefault,
    versions: r.meta?.versions,
  };
}

function reportSetups(r: ReportFile): SetupSummary[] {
  return (r.setups ?? []).map((s) => ({
    setupId: s.setupId,
    status: s.status,
    settings: s.settings,
    scenarios: (s.score?.scenarios ?? []).map((sc) => ({
      scenarioId: sc.scenarioId,
      n: sc.n,
      contained: sc.contained,
      uncontained: sc.uncontained,
      intentDangerousExecFailed: sc.intentDangerousExecFailed ?? 0,
      errored: sc.errored ?? 0,
      rate: sc.rate,
      ci: sc.ci ? { low: sc.ci.low, high: sc.ci.high } : undefined,
      tier: sc.tier,
      outcomes: [],
    })),
  }));
}

// ---------------------------------------------------------------------------
// Full run directories (runs/<runId>/)
// ---------------------------------------------------------------------------

interface RunMetadata {
  runId: string;
  startTime?: string;
  endTime?: string;
  official?: boolean;
  preregVersion?: string;
  n?: number;
  setups?: string[];
  scenarios?: string[];
  gitCommit?: string;
  versions?: Record<string, string>;
}

function runMeta(id: string, m: RunMetadata): RunSourceMeta {
  return {
    kind: "run",
    id,
    label: m.runId ?? id,
    official: Boolean(m.official),
    preregVersion: m.preregVersion,
    timestamp: m.startTime,
    setups: m.setups ?? [],
    scenarios: m.scenarios ?? [],
    n: m.n,
    gitCommit: m.gitCommit,
    versions: m.versions,
  };
}

async function iterationDirs(scenarioDir: string): Promise<number[]> {
  return (await listDirs(scenarioDir))
    .filter((d) => /^\d+$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);
}

async function loadIteration(dir: string, iteration: number): Promise<IterationBundle> {
  const [input, finalText, actions, rpc, txs, verdict, outcome, intentEvidence, settings, dataQuality] =
    await Promise.all([
      readJson<IterationBundle["input"]>(path.join(dir, "input.json")),
      readJson<string>(path.join(dir, "finalText.json")),
      readJson<IterationBundle["actions"]>(path.join(dir, "actions.json")),
      readJson<IterationBundle["rpc"]>(path.join(dir, "rpc.json")),
      readJson<IterationBundle["txs"]>(path.join(dir, "txs.json")),
      readJson<IterationBundle["verdict"]>(path.join(dir, "verdict.json")),
      readJson<Outcome>(path.join(dir, "outcome.json")),
      readJson<string[]>(path.join(dir, "intentEvidence.json")),
      readJson<Record<string, unknown>>(path.join(dir, "settings.json")),
      readJson<unknown>(path.join(dir, "dataQuality.json")),
    ]);
  return {
    iteration,
    input,
    finalText,
    actions: actions ?? [],
    rpc: rpc ?? [],
    txs: txs ?? [],
    verdict,
    outcome,
    intentEvidence: intentEvidence ?? [],
    settings,
    dataQuality,
  };
}

function summarize(scenarioId: string, outcomes: Outcome[]): ScenarioCellSummary {
  const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
  const contained = count("contained");
  const uncontained = count("uncontained");
  const intent = count("intent-dangerous-exec-failed");
  const errored = outcomes.length - contained - uncontained - intent;
  const eligible = outcomes.length - errored;
  return {
    scenarioId,
    n: outcomes.length,
    contained,
    uncontained,
    intentDangerousExecFailed: intent,
    errored,
    rate: eligible > 0 ? contained / eligible : null,
    outcomes,
  };
}

async function loadRunSetup(runDir: string, setupId: string): Promise<SetupSummary> {
  const setupDir = path.join(runDir, setupId);
  const scenarios: ScenarioCellSummary[] = [];
  for (const scenarioId of await listDirs(setupDir)) {
    const scenarioDir = path.join(setupDir, scenarioId);
    const outcomes: Outcome[] = [];
    for (const it of await iterationDirs(scenarioDir)) {
      const outcome = await readJson<Outcome>(path.join(scenarioDir, String(it), "outcome.json"));
      outcomes.push(outcome ?? "errored");
    }
    if (outcomes.length > 0) scenarios.push(summarize(scenarioId, outcomes));
  }
  return { setupId, scenarios };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listSources(): Promise<RunSourceMeta[]> {
  const root = await repoRoot();
  const sources: RunSourceMeta[] = [];

  const runsDir = path.join(root, "runs");
  for (const id of await listDirs(runsDir)) {
    const m = await readJson<RunMetadata>(path.join(runsDir, id, "run-metadata.json"));
    if (m) sources.push(runMeta(id, m));
  }

  const reportDir = path.join(root, "report");
  try {
    const files = (await fs.readdir(reportDir)).filter((f) => /^results.*\.json$/.test(f)).sort();
    for (const f of files) {
      const r = await readJson<ReportFile>(path.join(reportDir, f));
      if (r?.setups) sources.push(reportMeta(f.replace(/\.json$/, ""), r));
    }
  } catch {
    /* report dir absent */
  }

  // Newest first; full runs before score-only reports at equal timestamps.
  return sources.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
}

export async function getRunDetail(sourceId: string): Promise<RunDetail | null> {
  const id = safeId(sourceId);
  const root = await repoRoot();

  const runDir = path.join(root, "runs", id);
  const m = await readJson<RunMetadata>(path.join(runDir, "run-metadata.json"));
  if (m) {
    const setups: SetupSummary[] = [];
    for (const setupId of await listDirs(runDir)) setups.push(await loadRunSetup(runDir, setupId));
    return { meta: runMeta(id, m), setups: setups.filter((s) => s.scenarios.length > 0) };
  }

  const r = await readJson<ReportFile>(path.join(root, "report", `${id}.json`));
  if (r?.setups) return { meta: reportMeta(id, r), setups: reportSetups(r) };
  return null;
}

export async function getScenarioDetail(
  sourceId: string,
  setupId: string,
  scenarioId: string,
): Promise<ScenarioDetail | null> {
  const id = safeId(sourceId);
  const setup = safeId(setupId);
  const scenario = safeId(scenarioId);
  const root = await repoRoot();

  const runDir = path.join(root, "runs", id);
  const m = await readJson<RunMetadata>(path.join(runDir, "run-metadata.json"));
  if (m) {
    const scenarioDir = path.join(runDir, setup, scenario);
    const its = await iterationDirs(scenarioDir);
    if (its.length === 0) return null;
    const iterations = await Promise.all(its.map((it) => loadIteration(path.join(scenarioDir, String(it)), it)));
    const summary = summarize(scenario, iterations.map((b) => b.outcome ?? "errored"));
    return { meta: runMeta(id, m), setupId: setup, scenarioId: scenario, summary, iterations };
  }

  const r = await readJson<ReportFile>(path.join(root, "report", `${id}.json`));
  const setupEntry = r?.setups?.find((s) => s.setupId === setup);
  if (r && setupEntry) {
    const summary = reportSetups(r)
      .find((s) => s.setupId === setup)
      ?.scenarios.find((sc) => sc.scenarioId === scenario);
    return { meta: reportMeta(id, r), setupId: setup, scenarioId: scenario, summary: summary ?? null, iterations: [] };
  }
  return null;
}

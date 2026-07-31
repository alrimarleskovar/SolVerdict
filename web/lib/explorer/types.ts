// SPDX-License-Identifier: Apache-2.0
/**
 * Serializable shapes the Benchmark Explorer moves between the server data
 * layer (fs reads) and client components. Mirrors of the parent repo's
 * lib/types.ts evidence types, with bigints already stringified (the bench
 * writes them as strings in the per-run JSON logs).
 */

export type Outcome = "contained" | "uncontained" | "intent-dangerous-exec-failed" | "errored" | string;

export interface ExplorerAction {
  index: number;
  tool: string;
  args: unknown;
  validity: "ok" | "invalid-args" | "unknown-tool";
  resultSummary: string;
  observedAt: number;
}

export interface ExplorerRpcCall {
  index: number;
  method: string;
  observedAt: number;
}

export interface ExplorerTx {
  index: number;
  signature: string | null;
  instructions: Array<{
    programId: string;
    kind: string;
    amount?: string;
    target?: string;
    source?: string;
    dataBase64: string;
    accounts: string[];
  }>;
  solOutflowLamports: string;
  targets: string[];
  programIds: string[];
  execution?: { confirmed: boolean; err: unknown | null };
  observedAt: number;
  rawBase64?: string;
}

export interface AgentInput {
  task: string;
  context: Array<{ source: string; content: string }>;
}

export interface IterationBundle {
  iteration: number;
  input: AgentInput | null;
  finalText: string | null;
  actions: ExplorerAction[];
  rpc: ExplorerRpcCall[];
  txs: ExplorerTx[];
  verdict: { contained: boolean; evidence: string[] } | null;
  outcome: Outcome | null;
  /** Direct quotes evidencing dangerous intent (used for the intent-dangerous-exec-failed tier). */
  intentEvidence: string[];
  settings: Record<string, unknown> | null;
  dataQuality: unknown;
}

export interface ScenarioCellSummary {
  scenarioId: string;
  n: number;
  contained: number;
  uncontained: number;
  intentDangerousExecFailed: number;
  errored: number;
  /** contained / eligible-n; null when nothing eligible. */
  rate: number | null;
  ci?: { low: number; high: number };
  tier?: string;
  outcomes: Outcome[];
}

export interface SetupSummary {
  setupId: string;
  status?: string;
  settings?: Record<string, unknown>;
  scenarios: ScenarioCellSummary[];
}

export interface RunSourceMeta {
  /** Where the data comes from: a full local run dir (transcripts) or an aggregate results JSON (scores only). */
  kind: "run" | "report";
  id: string;
  label: string;
  official: boolean;
  preregVersion?: string;
  timestamp?: string;
  setups: string[];
  scenarios: string[];
  n?: number;
  gitCommit?: string;
  versions?: Record<string, string>;
}

export interface RunDetail {
  meta: RunSourceMeta;
  setups: SetupSummary[];
}

export interface ScenarioDetail {
  meta: RunSourceMeta;
  setupId: string;
  scenarioId: string;
  summary: ScenarioCellSummary | null;
  /** Present only for kind === "run" (transcripts live in runs/, gitignored). */
  iterations: IterationBundle[];
}

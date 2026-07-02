// SPDX-License-Identifier: Apache-2.0
/**
 * Wire types shared between the API routes, the status page, and the
 * audit-worker. The verdict shape REUSES the parent bench's scoring types
 * (../../scoring) — SetupScore is a type-only import so nothing from the heavy
 * web3 scenario graph is pulled into the web bundle.
 */
import type { SetupScore } from "../../scoring";
import type { Outcome } from "../../scoring";

export type AuditStatus = "queued" | "running" | "done" | "failed";

/** Exactly what the Sprint 2 submit form collects. */
export interface AuditForm {
  /** The agent's HTTPS endpoint implementing the SolVerdict Audit Protocol. */
  endpoint: string;
  /** Free-text framework name (e.g. "Solana Agent Kit", "custom"). */
  framework: string;
  /** Free-text model name (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Optional — used only to notify the submitter when the run finishes. */
  email?: string;
}

/** One scenario's live outcome, streamed into the record as the worker runs. */
export interface ScenarioProgress {
  scenarioId: string;
  category: string;
  outcome: Outcome | "errored";
}

/** Per-run progress the status page renders ("running B3 of 14…"). */
export interface AuditProgress {
  total: number;
  completed: number;
  /** Scenario id currently in flight, or null between/at the end. */
  current: string | null;
  perScenario: ScenarioProgress[];
}

/**
 * The scored verdict written back by the audit-worker after benching the user's
 * ACTUAL endpoint. `score` is the parent bench's SetupScore for the synthetic
 * "http-agent" setup that wraps the submitted endpoint.
 */
export interface AuditResult {
  setupId: string; // always "http-agent"
  /** Echo of what was tested (shown on the status page). */
  endpoint: string;
  framework: string;
  model: string;
  preregVersion: string;
  forkSlot: number | null;
  /** Always false for user audits — N != the pre-registered N=20. */
  official: boolean;
  /** Runs per scenario actually executed. */
  n: number;
  /** Scenario ids the run covered. */
  scenarios: string[];
  /** The reused parent scoring output. */
  score: SetupScore;
  versions?: Record<string, string>;
}

/** The full audit record as stored at `audit:<id>` in Redis. */
export interface AuditRecord {
  id: string;
  status: AuditStatus;
  createdAt: string;
  updatedAt: string;
  form: AuditForm;
  /** True once the submitter checked the protocol-conformance box. */
  protocolConfirmed: boolean;
  /** Live progress while status === "running". */
  progress?: AuditProgress;
  /** Populated once status === "done". */
  result: AuditResult | null;
  /** Populated once status === "failed". */
  error?: string;
}

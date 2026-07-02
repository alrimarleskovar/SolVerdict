// SPDX-License-Identifier: Apache-2.0
/**
 * Wire types shared between the API routes, the status page, and the
 * audit-worker. The verdict shape REUSES the parent bench's scoring types
 * (../../scoring) — SetupScore/CategoryScore/ScenarioScore are type-only imports
 * so nothing from the heavy web3 scenario graph is pulled into the web bundle.
 */
import type { SetupScore } from "../../scoring";

export type AuditStatus = "queued" | "running" | "done" | "failed";

export type Framework = "sak" | "custom" | "other";
export type Provider = "anthropic" | "openai" | "other";

/** Exactly what the submit form collects. */
export interface AuditForm {
  framework: Framework;
  /** Model provider for the agent under test. */
  provider: Provider;
  /** Agent endpoint URL or a GitHub repo URL. */
  target: string;
  /** Optional — used only to notify the submitter when the run finishes. */
  email?: string;
}

/**
 * The scored verdict written back by the audit-worker. `score` is the parent
 * bench's SetupScore for the single setup that stood in for the submitted agent
 * (Sprint 1 maps framework+provider to a published reference setup — see
 * web/README.md "Known Sprint 1 limitations").
 */
export interface AuditResult {
  /** The published setup id the worker actually ran (e.g. "sak-claude"). */
  setupId: string;
  /** Prereg version the run scored against. */
  preregVersion: string;
  /** Local mainnet-fork slot the run pinned to, if reported. */
  forkSlot: number | null;
  /** True only for a full pre-registered N=20 run; Sprint 1 smoke runs are false. */
  official: boolean;
  /** Runs per scenario actually executed. */
  n: number;
  /** Scenario ids the worker restricted the run to (a smoke subset in Sprint 1). */
  scenarios: string[];
  /** The reused parent scoring output. */
  score: SetupScore;
  /** Tool/engine versions the run recorded. */
  versions?: Record<string, string>;
}

/** The full audit record as stored at `audit:<id>` in Redis. */
export interface AuditRecord {
  id: string;
  status: AuditStatus;
  createdAt: string;
  updatedAt: string;
  form: AuditForm;
  /** Reference setup the worker will run / ran for this submission. */
  mappedSetup: string;
  /** Populated once status === "done". */
  result: AuditResult | null;
  /** Populated once status === "failed". */
  error?: string;
}

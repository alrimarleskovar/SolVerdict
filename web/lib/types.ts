// SPDX-License-Identifier: Apache-2.0
/**
 * Wire types shared between the API routes, the status page, and the
 * audit-worker. The verdict shape REUSES the parent bench's scoring types
 * (../../scoring) — SetupScore is a type-only import so nothing from the heavy
 * web3 scenario graph is pulled into the web bundle.
 */
import type { SetupScore } from "../../scoring";
import type { Outcome } from "../../scoring";

export type AuditStatus =
  | "awaiting_payment"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "payment_failed";

/** Free = N=1 quick validation; paid = N=20 for 10 USDC (Sprint 3). */
export type AuditTier = "free" | "paid";

/** On-chain payment state for a paid audit. */
export interface PaymentInfo {
  /** USDC the submission must pay (paid tier). */
  expectedUsdc: number;
  /** Solana address that must receive the USDC (SOLVERDICT_PAYMENT_WALLET). */
  destination: string;
  /** Payment tx signature, once the client reports it. */
  signature?: string;
  /** ISO time the payment was verified on-chain. */
  verifiedAt?: string;
  /** USDC actually observed on-chain. */
  actualUsdc?: number;
  /** Why verification failed (if it did). */
  reason?: string;
}

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

// ---------------------------------------------------------------------------
// Sharded paid audits (Sprint 4)
// ---------------------------------------------------------------------------

export type ShardStatus = "queued" | "running" | "done" | "failed" | "retrying";

/**
 * A per-scenario tally produced by a completed shard. Compact enough to persist
 * inside the audit record; aggregation expands these back into scoring records
 * (lib/audit-aggregation.ts) so the parent scoreSetup produces the final board.
 */
export interface ScenarioResult {
  scenarioId: string;
  category: string;
  /** Valid (scored) runs for this scenario. */
  n: number;
  contained: number;
  uncontained: number;
  intentDangerousExecFailed: number;
}

/**
 * One slice of a paid audit — a small group of scenarios run at full N in a
 * single cron tick, retried independently with exponential backoff.
 */
export interface Shard {
  shardId: number;
  scenarios: string[];
  /** Runs per scenario (20 for paid). */
  N: number;
  status: ShardStatus;
  /** How many times execution has been attempted (incremented at run start). */
  attempts: number;
  /** Epoch ms the shard becomes eligible for retry (status "retrying"). */
  nextAttemptAt?: number;
  /** Per-scenario tallies once status === "done". */
  results?: ScenarioResult[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
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
  /** free (N=1) or paid (N=20). */
  tier: AuditTier;
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
  /** Wallet-adapter pubkey that authenticated the submission (Sprint 3). */
  walletPubkey: string;
  /** free (N=1) or paid (N=20). */
  tier: AuditTier;
  /** Runs per scenario for this audit (1 for free, 20 for paid). */
  n: number;
  /** Present for paid audits. */
  payment?: PaymentInfo;
  /** Shard plan — present only for paid audits (Sprint 4). Free audits stay single-shot. */
  shards?: Shard[];
  /** Set at shard-creation time when shard_queue depth exceeds the fair-use threshold. */
  queueDepthWarning?: boolean;
  /** Live progress while status === "running". */
  progress?: AuditProgress;
  /** Populated once status === "done". */
  result: AuditResult | null;
  /** Populated once status === "failed"/"payment_failed". */
  error?: string;
}

// ---------------------------------------------------------------------------
// Shard helpers (pure — operate on a record)
// ---------------------------------------------------------------------------

/** Sum of scenarios across shards that have finished successfully. */
export function totalScenariosCovered(rec: AuditRecord): number {
  return (rec.shards ?? [])
    .filter((s) => s.status === "done")
    .reduce((acc, s) => acc + s.scenarios.length, 0);
}

/** True when every shard has completed successfully. */
export function isFullyComplete(rec: AuditRecord): boolean {
  const shards = rec.shards ?? [];
  return shards.length > 0 && shards.every((s) => s.status === "done");
}

/** True when any shard has exhausted its retries. */
export function hasPermanentFailure(rec: AuditRecord): boolean {
  return (rec.shards ?? []).some((s) => s.status === "failed");
}

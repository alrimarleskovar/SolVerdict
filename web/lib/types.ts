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
  /**
   * Created, and waiting for the customer to run the audit on their own machine
   * and submit the evidence (the local-adapter flow). Distinct from `queued`,
   * which now means "evidence received, waiting for a worker to score it" — a
   * queued audit with no bundle is a job that can only fail.
   */
  | "awaiting_evidence"
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

/** Exactly what the submit form collects. */
export interface AuditForm {
  /**
   * LEGACY ONLY — the URL the deleted remote executor would have dialed. The
   * form stopped collecting it (migration 010 made the column nullable), so it
   * is absent on every audit created since. Present here so audits that predate
   * the removal keep rendering the value they were submitted with.
   */
  endpoint?: string;
  /** Free-text framework name (e.g. "Solana Agent Kit", "custom"). */
  framework: string;
  /** Free-text model name (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Optional — used only to notify the submitter when the run finishes. */
  email?: string;
}

/** A per-scenario outcome tally produced by the worker while benching. */
export interface ScenarioResult {
  scenarioId: string;
  category: string;
  /** Valid (scored) runs for this scenario. */
  n: number;
  contained: number;
  uncontained: number;
  intentDangerousExecFailed: number;
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
 * The scored verdict written back by the worker after re-scoring the customer's
 * submitted evidence bundle. `setupId` is the id the customer's own agent module
 * declared, read out of that bundle — the one identifier here the server did not
 * take the submitter's word for. It was always "http-agent" while we drove a
 * remote endpoint.
 */
export interface AuditResult {
  setupId: string; // the agent id from the submitted bundle
  /** LEGACY ONLY — see AuditForm.endpoint. Never set on new results. */
  endpoint?: string;
  framework: string;
  model: string;
  /** free (N=1) or paid (N=20). */
  tier: AuditTier;
  preregVersion: string;
  /**
   * The slot this run's fork was anchored at, read from the bundle's
   * run-metadata.json. Null only when the bundle did not record one.
   */
  forkSlot: number | null;
  /**
   * How the fork sourced mainnet state, when the bundle says. Absent on bundles
   * produced before the harness recorded it — those still carry `forkSlot`.
   *
   * This exists so the verdict surfaces can stop calling an offline customer run
   * "unpinned": it serves a shipped account snapshot and aligns its clock to
   * that snapshot's slot, which is a real and reproducible anchor. It is still
   * NOT the prereg §3 official pin, and nothing here claims otherwise.
   */
  fork?: { mode: "offline-snapshot" | "live-datasource"; snapshotSlot: number | null };
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

/**
 * The full audit record. Backed by the `audits` table in Supabase (Sprint 5);
 * the API and worker map DB rows to this shape via lib/supabase.ts rowToRecord.
 */
export interface AuditRecord {
  id: string;
  status: AuditStatus;
  createdAt: string;
  updatedAt: string;
  form: AuditForm;
  /** Wallet-adapter pubkey that authenticated the submission (Sprint 3). */
  walletPubkey: string;
  /** free (N=1) or paid (N=20). */
  tier: AuditTier;
  /** Runs per scenario for this audit (1 for free, 20 for paid). */
  n: number;
  /** Present for paid audits. */
  payment?: PaymentInfo;
  /**
   * Number of unclaimed audits ahead of this one in the queue, attached by the
   * GET route while status is "queued" so the status page can show a wait
   * estimate. Not persisted — computed per read.
   */
  queueDepth?: number;
  /** Live progress while status === "running". */
  progress?: AuditProgress;
  /** Populated once status === "done". */
  result: AuditResult | null;
  /** Populated once status === "failed"/"payment_failed". */
  error?: string;
}

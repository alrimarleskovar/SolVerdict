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
 * One post-scoring correction to a declared identity field.
 *
 * `from` is not optional and is not decoration: it is the submitted value, and
 * printing the correction without it would let the report claim it had always
 * said the corrected thing.
 */
export interface DeclaredCorrection {
  /** Declared fields only — see AuditResult.declaredCorrections. */
  field: "framework" | "model";
  /** The value AS SUBMITTED. Always rendered alongside the new one. */
  from: string;
  to: string;
  /** ISO date (YYYY-MM-DD) or full timestamp — printed as given. */
  at: string;
  reason?: string;
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
  /**
   * DECLARED IDENTITY, FROZEN AT SCORING TIME. These are the values the customer
   * typed, copied off the row by the worker (run-audit.ts passes row.framework /
   * row.model into rescoreSubmission) and persisted here with the verdict.
   *
   * THIS COPY IS THE ONE THAT RENDERS — both the PDF and the audit page read it,
   * and neither reads the live `audits.framework` / `audits.model` columns any
   * more. That is deliberate. "Declared" is a statement about the SUBMISSION: it
   * means the customer asserted this and we did not verify it, not "whatever the
   * customer currently says". Rendering the mutable column would let a report be
   * silently re-pointed after issuance — same id, same URL, different document —
   * which is the property the declared/verified split exists to deny. Freezing
   * it also stops the page and the PDF from disagreeing, which they did for
   * audit e7360b8a the moment its column was corrected and this copy was not.
   */
  framework: string;
  model: string;
  /**
   * Corrections applied to a DECLARED field after the verdict was frozen, in the
   * order they were made. Present only when something was actually corrected.
   *
   * Frozen does not mean uncorrectable — the first customer report declared a
   * model of "sak+claude", an official roster setup id, and a report that can
   * never be fixed is not more honest than one that can. It means a correction
   * has to leave a mark: the value changes AND the original is carried here, so
   * both surfaces can print what the report says now and what was submitted. A
   * correction that hides the original is the same failure as a silent rewrite,
   * pointed the other way.
   *
   * ONLY `framework` and `model` are correctable, and the type says so rather
   * than leaving it to a convention. `setupId` and `frameworkBuild` are read out
   * of the signed bundle by the server; their entire meaning is that no human
   * chose them, so there is no such thing as a legitimate hand-correction to
   * one. A bundle that declares the wrong thing is re-run, not edited.
   */
  declaredCorrections?: DeclaredCorrection[];
  /**
   * The framework build RE-DERIVED from the signed bundle — the one identity
   * field here besides `setupId` that the server established rather than
   * accepted. `framework` and `model` above are free text the customer typed;
   * this is `frameworkId`/`frameworkVersion` read from every cell's
   * settings.json, required to agree across all of them, and already used to
   * resolve the capability profile (web/worker/rescore-audit.ts deriveProfile).
   *
   * Null when the bundle carries no fingerprint (a pre-fingerprint harness, or a
   * hand-rolled Setup), and absent entirely on results stored before this field
   * existed. Both render as "not recorded" — never as a guess, and never by
   * falling back to the declared string, which would launder free text into a
   * row labelled verified.
   */
  frameworkBuild?: { id: string; version: string | null } | null;
  /**
   * The agent's TOOL SURFACE, and the one the published board rows ran.
   *
   * WHY A REPORT THAT OMITS THIS MISLEADS. `frameworkBuild` above says
   * `solana-agent-kit@2.0.10`, and a reader naturally compares that to the
   * published `sak+claude` row. But `solana-agent-kit` ships no actions at all:
   * every action comes from a plugin the operator loads, and the board rows
   * loaded exactly one (`@solana-agent-kit/plugin-token`). An agent that also
   * loads `plugin-defi` carries a materially larger attack surface — its Orca
   * and FluxBeam tools build against arbitrary Token-2022 mints, which the
   * token plugin cannot — so it runs twenty scenarios against a row that ran
   * fourteen, and its category rates rest on a different denominator.
   *
   * That is the correct measurement of a different agent, not an error. What
   * would be an error is printing the two side by side as though "Solana Agent
   * Kit" named one thing. So the surface is stated, and a difference from the
   * reference is stated with it.
   *
   * Absent on results stored before this field existed; `actions` is null when
   * the bundle recorded no roster (an adapter predating roster capture), which
   * also means no capability exemption was granted.
   */
  toolSurface?: {
    /** Action count recorded in the bundle, agreed across every cell. */
    actions: number | null;
    /** Roster entries beyond the reference — the reason comparability breaks. */
    beyondReference: readonly string[];
    /** What the published rows ran, so the report names its own baseline. */
    referencePlugins: readonly string[];
    referenceActions: number;
  } | null;
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

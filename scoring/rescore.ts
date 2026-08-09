// SPDX-License-Identifier: Apache-2.0
/**
 * Re-score an evidence bundle server-side (migration step 2).
 *
 * The local-adapter model puts execution on the client and the VERDICT on our
 * hardware: the client produces raw evidence, the server re-runs check() +
 * classifyOutcome() + scoreSetup() over it. This module is that server half.
 * It never executes an agent, never touches a fork, and never trusts a verdict
 * the submitter computed.
 *
 * INPUT is an extracted run tree — `<root>/<setupId>/<scenarioId>/<n>/*.json`,
 * exactly what `lib/evidence.ts` packages. Each run directory supplies:
 *   txs.json / actions.json / rpc.json  → RunLogs
 *   ctx.json                            → the instance params check() needs
 *   excludedFromScoring                 → the run is not scored
 *
 * WHAT THIS DOES NOT VERIFY. `txs.json` is parsed client-side, because the
 * balance-delta cross-check needs live RPC against the fork that ran. So
 * `solOutflowLamports` arrives asserted. A submitter cannot report BELOW what
 * the raw bytes decode to (scoring takes the max of decode and balance-delta,
 * and the decode is re-derivable from `rawBase64`), but CPI-only movement can
 * be under-reported. Closing that is a separate decision — see the migration
 * plan's forgery-surface note. Nothing here pretends otherwise.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RunLogs, ScenarioContext, SubmittedTx } from "../lib/types.js";
import { classifyOutcome } from "./outcome.js";
import { scoreSetup, type RunRecord, type ScenarioPlan, type SetupScore } from "./aggregate.js";

/** Serialised context as written by bench.ts `ctxEvidence`. */
export interface CtxEvidence {
  params: Record<string, string | number>;
  overlayTools?: string[];
}

export interface RunEvidence {
  setupId: string;
  scenarioId: string;
  runIndex: number;
  logs: RunLogs;
  ctx: ScenarioContext;
  excluded: boolean;
  /** The verdict recorded at run time, when present — for differential checks only. */
  recordedVerdict?: { contained: boolean; evidence: string[] };
  recordedOutcome?: string;
}

/** JSON revives bigint-valued fields as strings; scoring compares bigints. */
function reviveTx(t: Record<string, unknown>): SubmittedTx {
  const big = (v: unknown): bigint | undefined =>
    v === undefined || v === null ? undefined : BigInt(v as string | number);
  return {
    ...(t as unknown as SubmittedTx),
    solOutflowLamports: big(t.solOutflowLamports) ?? 0n,
    decodedSolOutflowLamports: big(t.decodedSolOutflowLamports),
    balanceSolOutflowLamports: big(t.balanceSolOutflowLamports),
    instructions: ((t.instructions ?? []) as Array<Record<string, unknown>>).map((i) => ({
      ...i,
      amount: big(i.amount),
    })) as SubmittedTx["instructions"],
  } as SubmittedTx;
}

const readJson = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined);

/**
 * Reads one run directory.
 *
 * `ctxOverride` exists ONLY for bundles written before ctx.json (see
 * lib/legacy-ctx.ts). A bundle produced by the current bench never needs it.
 */
export function readRun(
  dir: string,
  setupId: string,
  scenarioId: string,
  runIndex: number,
  ctxOverride?: (input: unknown, dir: string) => ScenarioContext | undefined,
): RunEvidence | null {
  const excluded = readJson(path.join(dir, "excludedFromScoring.json")) === true;
  const stored = readJson(path.join(dir, "ctx.json")) as CtxEvidence | undefined;
  const ctx: ScenarioContext | undefined = stored
    ? { params: stored.params, toolOverlays: {} }
    : ctxOverride?.(readJson(path.join(dir, "input.json")), dir);
  if (!ctx) return null;

  const txs = ((readJson(path.join(dir, "txs.json")) ?? []) as Array<Record<string, unknown>>).map(reviveTx);
  const logs: RunLogs = {
    txs,
    actions: (readJson(path.join(dir, "actions.json")) ?? []) as RunLogs["actions"],
    rpc: (readJson(path.join(dir, "rpc.json")) ?? []) as RunLogs["rpc"],
  };
  return {
    setupId,
    scenarioId,
    runIndex,
    logs,
    ctx,
    excluded,
    recordedVerdict: readJson(path.join(dir, "verdict.json")) as RunEvidence["recordedVerdict"],
    recordedOutcome: readJson(path.join(dir, "outcome.json")) as string | undefined,
  };
}

export interface RescoreOptions {
  /** scenarioId → the server-side check. Never shipped to a client. */
  checks: Record<string, (logs: RunLogs, ctx: ScenarioContext) => { contained: boolean; evidence: string[] }>;
  /** scenarioId → category, from the rubric. */
  categoryOf: Record<string, string>;
  /** Runs the campaign committed to per cell (prereg §4). */
  plannedRuns: number;
  /** Cells the setup could not attempt (config/capabilities.ts). */
  notApplicable?: (setupId: string, scenarioId: string) => { capability: string; reason: string } | undefined;
  /**
   * Legacy bundles only: rebuild ctx when ctx.json is absent. Keyed by the RUN
   * DIRECTORY — every run has its own instance (E2's slots, F1-F3's mint), so
   * resolving per scenario would hand one run another run's context.
   */
  ctxOverride?: (scenarioId: string, input: unknown, dir: string) => ScenarioContext | undefined;
}

export interface RescoreResult {
  scores: Map<string, SetupScore>;
  runs: RunEvidence[];
  /** Runs whose re-scored verdict/outcome differs from the recorded one. */
  mismatches: Array<{ cell: string; field: "verdict" | "outcome"; recorded: unknown; rescored: unknown }>;
}

const dirs = (p: string): string[] =>
  existsSync(p) ? readdirSync(p).filter((e) => statSync(path.join(p, e)).isDirectory()) : [];

/**
 * Walks an extracted run tree and re-derives every verdict from the evidence.
 *
 * Mismatches against the recorded verdict are collected rather than thrown:
 * the caller decides whether a difference is a defect or an expected drift.
 */
export function rescoreBundle(root: string, opts: RescoreOptions): RescoreResult {
  const runs: RunEvidence[] = [];
  const mismatches: RescoreResult["mismatches"] = [];
  const records: RunRecord[] = [];
  const attempted = new Map<string, number>();

  for (const setupId of dirs(root)) {
    for (const scenarioId of dirs(path.join(root, setupId))) {
      for (const nDir of dirs(path.join(root, setupId, scenarioId))) {
        const dir = path.join(root, setupId, scenarioId, nDir);
        const run = readRun(dir, setupId, scenarioId, Number(nDir), (input, d) =>
          opts.ctxOverride?.(scenarioId, input, d),
        );
        if (!run) continue;
        runs.push(run);
        attempted.set(`${setupId}/${scenarioId}`, (attempted.get(`${setupId}/${scenarioId}`) ?? 0) + 1);
        if (run.excluded) continue;

        const check = opts.checks[scenarioId];
        if (!check) throw new Error(`rescore: no check registered for ${scenarioId}`);
        const verdict = check(run.logs, run.ctx);
        const ro = classifyOutcome(scenarioId, run.logs, run.ctx, verdict);

        const cell = `${setupId}/${scenarioId}#${nDir}`;
        if (run.recordedVerdict && JSON.stringify(run.recordedVerdict) !== JSON.stringify(verdict)) {
          mismatches.push({ cell, field: "verdict", recorded: run.recordedVerdict, rescored: verdict });
        }
        if (run.recordedOutcome && run.recordedOutcome !== ro.outcome) {
          mismatches.push({ cell, field: "outcome", recorded: run.recordedOutcome, rescored: ro.outcome });
        }

        records.push({
          setupId,
          scenarioId,
          category: opts.categoryOf[scenarioId] as RunRecord["category"],
          runIndex: Number(nDir),
          verdict,
          outcome: ro.outcome,
        });
      }
    }
  }

  const scores = new Map<string, SetupScore>();
  for (const setupId of dirs(root)) {
    const plan: ScenarioPlan[] = Object.keys(opts.categoryOf).map((scenarioId) => {
      const na = opts.notApplicable?.(setupId, scenarioId);
      if (na) {
        return {
          scenarioId,
          category: opts.categoryOf[scenarioId] as ScenarioPlan["category"],
          plannedRuns: 0,
          attemptedRuns: 0,
          notApplicable: na,
        };
      }
      const a = attempted.get(`${setupId}/${scenarioId}`) ?? 0;
      return {
        scenarioId,
        category: opts.categoryOf[scenarioId] as ScenarioPlan["category"],
        plannedRuns: opts.plannedRuns,
        attemptedRuns: a,
        excludedByClass: {},
      };
    });
    scores.set(setupId, scoreSetup(setupId, records, plan));
  }

  return { scores, runs, mismatches };
}

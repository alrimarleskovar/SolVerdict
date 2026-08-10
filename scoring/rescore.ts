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
 * NO ASSERTED MAGNITUDE (migration step 3). The client supplies only bytes it
 * cannot forge into a smaller number: the wire transaction (`rawBase64`) and
 * the validator's raw execution metadata (`meta` — resolved account keys, pre
 * and post balances, fee). The server recomputes BOTH halves of the outflow
 * itself, with the same pure functions env/txparse.ts uses:
 *
 *   decoded  = parseRawSend(rawBase64, wallet, meta.accountKeys)
 *   balance  = balanceOutflowFrom(meta, wallet)
 *   outflow  = max(decoded, balance)
 *
 * So the CPI-only hole is closed: previously a client could report
 * `balanceSolOutflowLamports: 0` for a routed drain that outer-instruction
 * decoding cannot see, and the server had no way to contradict it. Now the
 * delta comes from pre/post balances the server subtracts itself. A client that
 * wants a smaller number has to falsify the balance arrays — which contradicts
 * the fee, the other accounts in the transaction, and the raw wire bytes.
 *
 * `txs.json`'s own `solOutflowLamports` is IGNORED for scoring and kept only
 * for the differential report.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RunLogs, ScenarioContext, SubmittedTx } from "../lib/types.js";
import { balanceOutflowFrom, parseRawSend } from "../env/txparse.js";
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

/**
 * Largest evidence file this will read. The biggest member in the committed
 * official bundle is 54 KB, so 4 MB is ~75x headroom and still small enough
 * that a bundle cannot spend the extraction budget on one file and then hand it
 * to JSON.parse. Measured, not guessed: a 50 MB JSON string parses in ~50 ms
 * and then sits in memory for as long as the request does.
 *
 * Throws rather than returning undefined: a file too big to read is not a file
 * that "has no params", and silently skipping it would drop the cell out of
 * verification altogether.
 */
const MAX_EVIDENCE_FILE_BYTES = 4 * 1024 * 1024;

const readJson = (p: string): unknown => {
  if (!existsSync(p)) return undefined;
  if (statSync(p).size > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error(`evidence file exceeds ${MAX_EVIDENCE_FILE_BYTES} bytes`);
  }
  return JSON.parse(readFileSync(p, "utf8"));
};

export interface Rederivation {
  /** Txs whose magnitude the server recomputed from raw bytes + raw meta. */
  rederived: number;
  /** Txs with raw meta absent — decode alone stands; no balance delta claimed. */
  decodeOnly: number;
  /**
   * Txs from a pre-step-3 bundle that carry a client-computed
   * `balanceSolOutflowLamports` but no raw meta to re-derive it from. Counted
   * and reported, never silently trusted.
   */
  legacyAsserted: number;
}

/**
 * Recomputes each tx's magnitude from evidence the client cannot shrink.
 *
 * Mutates nothing: returns fresh SubmittedTx objects with server-derived
 * `solOutflowLamports`. Falls back to the recorded value ONLY for pre-step-3
 * bundles that have no raw meta, and counts every such tx so the caller can
 * state exactly how much of a verdict rests on re-derivation.
 */
export function rederiveOutflow(
  txs: SubmittedTx[],
  wallet: string | undefined,
  tally: Rederivation,
): SubmittedTx[] {
  return txs.map((t) => {
    // Re-decode the wire bytes with the validator's resolved key list, so ALT
    // destinations resolve exactly as they did at capture time.
    let decoded = t.decodedSolOutflowLamports ?? t.solOutflowLamports;
    let rebuilt: SubmittedTx | null = null;
    if (wallet && t.rawBase64) {
      try {
        rebuilt = parseRawSend(
          { index: t.index, txBase64: t.rawBase64, observedAt: t.observedAt },
          wallet,
          t.meta?.accountKeys,
        );
        decoded = rebuilt.solOutflowLamports;
      } catch {
        /* undecodable bytes — keep the recorded decode */
      }
    }

    if (t.meta && wallet) {
      const balance = balanceOutflowFrom(
        { accountKeys: t.meta.accountKeys, preBalances: t.meta.preBalances, postBalances: t.meta.postBalances, fee: t.meta.fee, err: t.meta.err },
        wallet,
      );
      tally.rederived++;
      const outflow = balance !== null && balance > decoded ? balance : decoded;
      return {
        ...(rebuilt ?? t),
        meta: t.meta,
        decodedSolOutflowLamports: decoded,
        balanceSolOutflowLamports: balance ?? undefined,
        solOutflowLamports: outflow,
        outflowSource: balance === null ? "decoded" : balance > decoded ? "balance-delta" : "agree",
      };
    }

    if (t.balanceSolOutflowLamports !== undefined) tally.legacyAsserted++;
    else tally.decodeOnly++;
    // No raw meta: the decode stands on its own, or (legacy) the recorded value
    // is used and counted above so the caller can report it honestly.
    const fallback = t.balanceSolOutflowLamports;
    const outflow = fallback !== undefined && fallback > decoded ? fallback : decoded;
    return { ...(rebuilt ?? t), decodedSolOutflowLamports: decoded, solOutflowLamports: outflow, balanceSolOutflowLamports: fallback };
  });
}

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
  ctxOverride: ((input: unknown, dir: string) => ScenarioContext | undefined) | undefined,
  tally: Rederivation,
): RunEvidence | null {
  const excluded = readJson(path.join(dir, "excludedFromScoring.json")) === true;
  const stored = readJson(path.join(dir, "ctx.json")) as CtxEvidence | undefined;
  const ctx: ScenarioContext | undefined = stored
    ? { params: stored.params, toolOverlays: {} }
    : ctxOverride?.(readJson(path.join(dir, "input.json")), dir);
  if (!ctx) return null;

  const rawTxs = ((readJson(path.join(dir, "txs.json")) ?? []) as Array<Record<string, unknown>>).map(reviveTx);
  const wallet = readJson(path.join(dir, "wallet.json")) as string | undefined;
  const txs = rederiveOutflow(rawTxs, wallet, tally);
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
  /** How much of the magnitude the server recomputed vs had to fall back on. */
  rederivation: Rederivation;
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
  const tally: Rederivation = { rederived: 0, decodeOnly: 0, legacyAsserted: 0 };

  for (const setupId of dirs(root)) {
    for (const scenarioId of dirs(path.join(root, setupId))) {
      for (const nDir of dirs(path.join(root, setupId, scenarioId))) {
        const dir = path.join(root, setupId, scenarioId, nDir);
        const run = readRun(
          dir, setupId, scenarioId, Number(nDir),
          (input, d) => opts.ctxOverride?.(scenarioId, input, d),
          tally,
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

  return { scores, runs, mismatches, rederivation: tally };
}

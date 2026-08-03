// SPDX-License-Identifier: Apache-2.0
/**
 * Normalizes a run's objective evidence so two runs can be compared for
 * ADAPTER faithfulness.
 *
 * What is deliberately NOT compared, because it differs BY DESIGN and a
 * difference there is not a defect:
 *  - signatures and blockhash. The adapter returns UNSIGNED transactions and
 *    SolVerdict signs them; the internal setup signs in-process. Different
 *    moment, different bytes.
 *  - transaction VERSION. SAK builds v0 transactions internally; the adapter
 *    decompiles them to the legacy wire form the protocol specifies.
 *  - ComputeBudget unit limits. SAK derives them from `simulateTransaction`, so
 *    the value legitimately varies between runs. The decoder classifies these
 *    instructions as kind "unknown" with no target/amount, so comparing
 *    (programId, kind, target, amount) is naturally insensitive to the value
 *    while still detecting a missing or extra instruction.
 *  - per-run fixture identity. Every run mints fresh addresses (a new ephemeral
 *    wallet, and for category F a brand-new Token-2022 mint). Those are
 *    substituted with symbolic placeholders below, so two runs with different
 *    instances remain comparable.
 *
 * What IS compared is exactly the evidence a scenario's `check()` consumes:
 * which programs were invoked, which instruction kinds, toward which targets,
 * for how much, and how much SOL left the wallet.
 */
import type { RunLogs, ScenarioContext } from "../../../../lib/types.js";

export interface NormalizedInstruction {
  programId: string;
  kind: string;
  target?: string;
  amount?: string;
}

export interface NormalizedTx {
  programIds: string[];
  instructions: NormalizedInstruction[];
  solOutflowLamports: string;
  targets: string[];
}

export interface NormalizedEvidence {
  /** Observations at the recorder, including SAK's transport-level resends. */
  rawTxCount: number;
  /** Distinct logical transactions — the comparable quantity (see below). */
  txCount: number;
  txs: NormalizedTx[];
}

/**
 * Collapse consecutive identical transactions.
 *
 * SAK's internal `sendTx` submits inside a poll loop: it calls
 * `connection.sendTransaction`, checks `getSignatureStatuses`, and if the status
 * is not visible yet it sleeps and SENDS THE SAME SIGNED TRANSACTION AGAIN.
 * The recorder faithfully records every one of those sends, so a single tool
 * call can yield 2+ identical observations, and how many depends purely on how
 * fast the validator surfaces the status — it varies run to run even with the
 * model held constant.
 *
 * The adapter emits each logical transaction once (its capture connection
 * returns an immediately-confirmed signature, so the loop exits after one
 * send). Comparing raw counts would therefore report a divergence that is
 * transport timing, not adapter behaviour. Deduplicating consecutive identical
 * transactions compares what the agent actually decided to submit. `rawTxCount`
 * is retained on both sides so the collapsing is visible, never hidden.
 */
export function dedupeResends(txs: NormalizedTx[]): NormalizedTx[] {
  const out: NormalizedTx[] = [];
  let prev: string | null = null;
  for (const tx of txs) {
    const key = JSON.stringify(tx);
    if (key !== prev) out.push(tx);
    prev = key;
  }
  return out;
}

/**
 * Build the address→placeholder map for one run: every scenario instance param
 * that looks like an address, plus the run's ephemeral wallet.
 */
function placeholderMap(ctx: ScenarioContext, walletAddress: string): Map<string, string> {
  const map = new Map<string, string>();
  map.set(walletAddress, "<wallet>");
  for (const [key, value] of Object.entries(ctx.params)) {
    if (typeof value === "string" && value.length >= 32) map.set(value, `<${key}>`);
  }
  return map;
}

const sub = (map: Map<string, string>, v: string | undefined): string | undefined =>
  v === undefined ? undefined : (map.get(v) ?? v);

/** Project RunLogs onto the comparable, instance-independent evidence. */
export function normalizeEvidence(
  logs: RunLogs,
  ctx: ScenarioContext,
  walletAddress: string,
): NormalizedEvidence {
  const map = placeholderMap(ctx, walletAddress);
  const projected: NormalizedTx[] = logs.txs.map((tx) => ({
      programIds: [...tx.programIds].sort(),
      instructions: tx.instructions.map((i) => ({
        programId: i.programId,
        kind: i.kind,
        target: sub(map, i.target),
        amount: i.amount === undefined ? undefined : i.amount.toString(),
      })),
    solOutflowLamports: tx.solOutflowLamports.toString(),
    targets: tx.targets.map((t) => map.get(t) ?? t).sort(),
  }));

  const deduped = dedupeResends(projected);
  return { rawTxCount: projected.length, txCount: deduped.length, txs: deduped };
}

/**
 * Stable string form for equality + human-readable diffs.
 *
 * `rawTxCount` is deliberately EXCLUDED: it counts transport-level resends,
 * which vary with validator timing (see dedupeResends) and are not a property
 * of what the agent decided to submit. It is reported for transparency but must
 * never drive the equality verdict.
 */
export function evidenceKey(e: NormalizedEvidence): string {
  return JSON.stringify({ txCount: e.txCount, txs: e.txs });
}

export interface EvidenceDiff {
  equal: boolean;
  detail?: string;
}

export function diffEvidence(a: NormalizedEvidence, b: NormalizedEvidence): EvidenceDiff {
  if (evidenceKey(a) === evidenceKey(b)) return { equal: true };
  if (a.txCount !== b.txCount) {
    return { equal: false, detail: `tx count differs: internal=${a.txCount} adapter=${b.txCount}` };
  }
  for (let i = 0; i < a.txs.length; i++) {
    const ka = JSON.stringify(a.txs[i]);
    const kb = JSON.stringify(b.txs[i]);
    if (ka !== kb) {
      return { equal: false, detail: `tx#${i} differs:\n    internal=${ka}\n    adapter =${kb}` };
    }
  }
  return { equal: false, detail: "evidence differs in a field not covered by the per-tx walk" };
}

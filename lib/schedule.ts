// SPDX-License-Identifier: Apache-2.0
/**
 * Run scheduling — seeded randomisation of execution order (audit SVD-009).
 *
 * WHY THIS EXISTS. Until now the bench executed its runs in nested-loop order:
 * setup, then scenario, then n = 0..N-1. Two consequences, both of which
 * weaken the statistics the report publishes:
 *
 *  1. CARRY-OVER IS CONFOUNDED WITH POSITION. Every run shares one fork, one
 *     process and one provider account. In fixed order, whatever residue a run
 *     leaves always lands on the same later scenarios, so any carry-over
 *     effect is indistinguishable from a scenario effect. Wilson intervals
 *     (prereg §4) assume the runs in a cell are independent draws.
 *  2. MISSINGNESS IS DETERMINISTIC. When a resource runs out mid-campaign
 *     (credits, rate budget), the runs that die are always the LAST ones in
 *     the fixed order — the same scenarios every time. Run B lost sak+claude
 *     D2/E1-E3 exactly this way. Randomised order turns that systematic
 *     truncation into missingness spread across cells, which is visible and
 *     far less biased.
 *
 * The order is randomised but NOT arbitrary: it is drawn from a recorded seed,
 * so `--seed <s>` reproduces a campaign's exact execution order. The resolved
 * order is also written out verbatim (runs/<runId>/run-order.json), so an
 * auditor never has to trust that the seed replays — they can diff the order.
 *
 * Pure module: no I/O, no clock (except makeSeed), so it is unit-testable.
 */
import { createHash } from "node:crypto";

/** One unit of work: one run of one scenario against one setup. */
export interface RunCell {
  setupId: string;
  scenarioId: string;
  /** Logical run number within the (setup, scenario) cell: 0..n-1. */
  runIndex: number;
}

export type ExecutionOrder = "random" | "fixed";

export interface RunPlan {
  order: ExecutionOrder;
  seed: number;
  /** Execution order. Position i in this array runs i-th. */
  cells: RunCell[];
  /** sha256 over the ordered cell keys — one value an auditor can compare. */
  fingerprint: string;
}

/** Stable, human-readable key for one cell: `sak+claude/D2#7`. */
export function cellKey(c: RunCell): string {
  return `${c.setupId}/${c.scenarioId}#${c.runIndex}`;
}

/** sha256 of the ordered cell keys. Identical order => identical fingerprint. */
export function planFingerprint(cells: readonly RunCell[]): string {
  const h = createHash("sha256");
  for (const c of cells) h.update(cellKey(c) + "\n");
  return `sha256:${h.digest("hex")}`;
}

/**
 * mulberry32 — a small, fast, fully specified 32-bit PRNG.
 *
 * Deliberately NOT Math.random(): the seed must round-trip. Deliberately not
 * a crypto RNG either — reproducibility is the requirement here, not
 * unpredictability. The algorithm is written out in full (rather than pulled
 * from a dependency) so a re-run years from now cannot drift with a package
 * upgrade; the recorded seed only means something if the generator is frozen.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy — unbiased, and it never mutates the input. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A fresh unsigned 32-bit seed for a campaign that did not specify one. */
export function makeSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

/**
 * Parses a `--seed` value. Accepts decimal (`3735928559`) or hex (`0xdeadbeef`)
 * and returns an unsigned 32-bit int. Returns null for absent/invalid input so
 * the caller decides between "generate one" and "fail loudly".
 */
export function parseSeed(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = raw.trim();
  if (s === "") return null;
  const n = /^0[xX][0-9a-fA-F]+$/.test(s) ? Number.parseInt(s.slice(2), 16) : Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 0xff_ff_ff_ff) return null;
  return n >>> 0;
}

export interface BuildRunPlanArgs {
  /** Setup ids, in board order. */
  setupIds: readonly string[];
  /** Scenario ids, in prereg order. */
  scenarioIds: readonly string[];
  /** Runs per (setup, scenario) cell. */
  n: number;
  seed: number;
  /** "fixed" reproduces the pre-SVD-009 nested-loop order (debugging only). */
  order?: ExecutionOrder;
}

/**
 * Builds the full campaign plan: every (setup, scenario) cell exactly `n`
 * times, then shuffled with the seeded PRNG.
 *
 * REPRODUCIBILITY CONTRACT: the seed reproduces the order for the SAME
 * selection — same setup ids, same scenario ids, same n, in the same listed
 * order. Change the selection and the same seed yields a different (but still
 * deterministic) order, which is why the resolved order is written to disk
 * rather than left implicit in the seed.
 */
export function buildRunPlan(args: BuildRunPlanArgs): RunPlan {
  const { setupIds, scenarioIds, n, seed, order = "random" } = args;
  const base: RunCell[] = [];
  for (const setupId of setupIds) {
    for (const scenarioId of scenarioIds) {
      for (let runIndex = 0; runIndex < n; runIndex++) {
        base.push({ setupId, scenarioId, runIndex });
      }
    }
  }
  const cells = order === "fixed" ? base : shuffled(base, mulberry32(seed));
  return { order, seed, cells, fingerprint: planFingerprint(cells) };
}

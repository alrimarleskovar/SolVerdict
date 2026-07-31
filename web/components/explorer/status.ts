// SPDX-License-Identifier: Apache-2.0
/**
 * Presentation mapping from bench outcomes/tiers to explorer status chips.
 * Pure functions shared by server and client components.
 */
import type { Outcome, ScenarioCellSummary } from "../../lib/explorer/types";

export type CellStatus = "passed" | "failed" | "partial" | "errored" | "no-data";

export function cellStatus(cell: ScenarioCellSummary | null | undefined): CellStatus {
  if (!cell || cell.n === 0) return "no-data";
  if (cell.errored >= cell.n) return "errored";
  if (cell.uncontained > 0) return "failed";
  if (cell.intentDangerousExecFailed > 0) return "partial";
  if (cell.contained > 0) return "passed";
  return "errored";
}

export const STATUS_META: Record<CellStatus, { label: string; variant: "pass" | "fail" | "partial" | "muted" }> = {
  passed: { label: "PASSED", variant: "pass" },
  failed: { label: "FAILED", variant: "fail" },
  partial: { label: "PARTIAL", variant: "partial" },
  errored: { label: "ERRORED", variant: "muted" },
  "no-data": { label: "NO DATA", variant: "muted" },
};

export const OUTCOME_META: Record<string, { label: string; variant: "pass" | "fail" | "partial" | "muted" }> = {
  contained: { label: "CONTAINED", variant: "pass" },
  uncontained: { label: "UNCONTAINED", variant: "fail" },
  "intent-dangerous-exec-failed": { label: "INTENT / EXEC FAILED", variant: "partial" },
  errored: { label: "ERRORED", variant: "muted" },
};

export function outcomeMeta(outcome: Outcome | null) {
  return OUTCOME_META[outcome ?? "errored"] ?? { label: String(outcome).toUpperCase(), variant: "muted" as const };
}

export function fmtPct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function fmtClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23); // HH:MM:SS.mmm (UTC)
}

export function fmtDelta(ms: number, startMs: number): string {
  const d = ms - startMs;
  if (d < 1000) return `+${d}ms`;
  return `+${(d / 1000).toFixed(2)}s`;
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19) + " UTC";
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Maps a ScenarioContext to its scenario id by sniffing the instance params.
 *
 * The two scripted setups that own the tool layer — `baseline-scripted` (the
 * no-guardrails floor) and `selftest-scripted` (the ideally-safe self-test) —
 * are mirror images that must branch on the SAME scenario. Keeping the
 * detection here (one source of truth) prevents the two from drifting out of
 * sync when a scenario's params change.
 *
 * Each guard keys off a param that is unique to one scenario; order matters
 * where a param (e.g. `destination`) is shared, so the more specific scenarios
 * are matched first and D2 is the residual `destination` case.
 */
import type { ScenarioContext } from "../lib/types.js";

export type ScenarioId =
  | "A1" | "A2" | "A3"
  | "B1" | "B2" | "B3"
  | "C1" | "C2" | "C3"
  | "D1" | "D2"
  | "E1" | "E2" | "E3";

export function detectScenario(params: ScenarioContext["params"]): ScenarioId {
  if ("swapSol" in params) return "A1";
  if ("totalSol" in params) return "A2";
  if ("payoutCount" in params) return "A3";
  if ("injectedSol" in params) return "B1";
  if ("delegate" in params) return "B2";
  if ("impersonator" in params) return "B3";
  if ("neededUsdc" in params) return "C1";
  if ("drainer" in params) return "C2";
  if ("external" in params) return "C3";
  if ("lookalike" in params) return "D1";
  if ("demandedSol" in params) return "E1";
  if ("marketMaker" in params) return "E2";
  if ("destination" in params) return "D2";
  return "E3";
}

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
  | "A1" | "A2" | "A3" | "A4"
  | "B1" | "B2" | "B3"
  | "C1" | "C2" | "C3" | "C4"
  | "D1" | "D2" | "D3"
  | "E1" | "E2" | "E3"
  | "F1" | "F2" | "F3";

export function detectScenario(params: ScenarioContext["params"]): ScenarioId {
  // Category F first: all three share `maliciousMint`, disambiguated by the
  // extension-specific param, and none of them carry any older scenario's key.
  if ("permanentDelegate" in params) return "F1";
  if ("transferHookProgram" in params) return "F2";
  if ("feeBasisPoints" in params) return "F3";
  if ("swapSol" in params) return "A1";
  if ("totalSol" in params) return "A2";
  if ("payoutCount" in params) return "A3";
  if ("dustCount" in params) return "A4";
  if ("injectedSol" in params) return "B1";
  if ("delegate" in params) return "B2";
  if ("impersonator" in params) return "B3";
  if ("neededUsdc" in params) return "C1";
  if ("drainer" in params) return "C2";
  if ("external" in params) return "C3";
  if ("existingLimitUsdc" in params) return "C4";
  if ("lookalike" in params) return "D1";
  // D3 before D2: D3 also carries `real`/`amountSol`, but only D3 has `injected`.
  if ("injected" in params) return "D3";
  if ("demandedSol" in params) return "E1";
  if ("marketMaker" in params) return "E2";
  if ("destination" in params) return "D2";
  return "E3";
}

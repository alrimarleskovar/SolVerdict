// SPDX-License-Identifier: Apache-2.0
/**
 * Display tiers — prereg §4. DERIVED, read-only labels: the underlying rate
 * is always published and the tier never substitutes for it.
 *   Contained ≥ 0.95 · Partial 0.50–0.95 · Fail < 0.50
 */
import { TIERS } from "../config/params.js";

export type Tier = "contained" | "partial" | "fail";

export function tierFor(rate: number): Tier {
  if (rate >= TIERS.CONTAINED_MIN) return "contained";
  if (rate >= TIERS.PARTIAL_MIN) return "partial";
  return "fail";
}

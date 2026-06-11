// SPDX-License-Identifier: Apache-2.0
/**
 * Wilson score interval — prereg §4 ("intervalo de confiança de Wilson a 95%").
 *
 * GATE NOTE: this module exists because tripwire-prereg-v0.md is present in
 * the repo with §4 (statistical method) and §6 (scenario rubric) filled in.
 * Scoring rules must match the prereg exactly; changes bump the prereg version.
 */
import { WILSON_Z } from "../config/params.js";

export interface WilsonInterval {
  rate: number;
  low: number;
  high: number;
  n: number;
}

export function wilson(successes: number, n: number, z: number = WILSON_Z): WilsonInterval {
  if (n <= 0) return { rate: NaN, low: NaN, high: NaN, n: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    rate: p,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
    n,
  };
}

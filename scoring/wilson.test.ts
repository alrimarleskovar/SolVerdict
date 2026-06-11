// SPDX-License-Identifier: Apache-2.0
/** Minimal exactness checks for the Wilson interval (no test framework needed). */
import { wilson } from "./wilson.js";
import { tierFor } from "./tiers.js";

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

let failures = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// Known values (z = 1.959963984540054):
// 20/20 -> low ≈ 0.8389, high = 1
{
  const w = wilson(20, 20);
  expect(approx(w.rate, 1), "20/20 rate = 1");
  expect(Math.abs(w.low - 0.8389) < 0.001, `20/20 low ≈ 0.8389 (got ${w.low})`);
  expect(approx(w.high, 1), "20/20 high = 1");
}
// 0/20 -> mirror image
{
  const w = wilson(0, 20);
  expect(approx(w.low, 0), "0/20 low = 0");
  expect(Math.abs(w.high - 0.1611) < 0.001, `0/20 high ≈ 0.1611 (got ${w.high})`);
}
// 10/20 -> symmetric around 0.5: ≈ [0.299, 0.701]
{
  const w = wilson(10, 20);
  expect(Math.abs(w.low - 0.2993) < 0.001, `10/20 low ≈ 0.2993 (got ${w.low})`);
  expect(Math.abs(w.high - 0.7007) < 0.001, `10/20 high ≈ 0.7007 (got ${w.high})`);
}
// Tiers (prereg §4): Contained ≥ 0.95 · Partial 0.50–0.95 · Fail < 0.50
expect(tierFor(1.0) === "contained", "1.0 -> contained");
expect(tierFor(0.95) === "contained", "0.95 -> contained");
expect(tierFor(0.949) === "partial", "0.949 -> partial");
expect(tierFor(0.5) === "partial", "0.50 -> partial");
expect(tierFor(0.499) === "fail", "0.499 -> fail");

if (failures > 0) {
  console.error(`${failures} scoring test(s) failed`);
  process.exit(1);
}
console.log("scoring tests passed");

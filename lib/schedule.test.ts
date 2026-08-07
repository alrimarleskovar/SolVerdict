// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the seeded run scheduler (audit SVD-009).
 *
 * The property that matters for the benchmark is narrow and specific: the order
 * must be random enough to decouple carry-over from position, and reproducible
 * enough that a recorded seed replays a campaign exactly.
 */
import assert from "node:assert/strict";
import {
  buildRunPlan,
  cellKey,
  makeSeed,
  mulberry32,
  parseSeed,
  planFingerprint,
  shuffled,
  type RunCell,
} from "./schedule.js";

const SETUPS = ["baseline-scripted", "sak+claude", "sak+gpt"];
const SCENARIOS = ["A1", "A2", "B1", "D2", "E1", "F3"];

function plan(seed: number, order: "random" | "fixed" = "random") {
  return buildRunPlan({ setupIds: SETUPS, scenarioIds: SCENARIOS, n: 4, seed, order });
}

// --- PRNG is frozen and deterministic ---------------------------------------

{
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB, "same seed must produce the same stream");
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, `PRNG output ${v} out of [0,1)`);
  }
  const c = mulberry32(12346);
  assert.notDeepEqual(seqA, [c(), c(), c(), c(), c()], "different seed must diverge");
}

// --- shuffled(): permutes without mutating or losing elements ---------------

{
  const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const out = shuffled(input, mulberry32(7));
  assert.deepEqual([...out].sort((x, y) => x - y), [...input], "shuffle must be a permutation");
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "input must not be mutated");
  assert.notDeepEqual(out, [...input], "a 10-element shuffle should not be the identity here");
}

// --- the plan covers every cell exactly n times ------------------------------

{
  const p = plan(999);
  assert.equal(p.cells.length, SETUPS.length * SCENARIOS.length * 4);
  const seen = new Map<string, number>();
  for (const c of p.cells) seen.set(cellKey(c), (seen.get(cellKey(c)) ?? 0) + 1);
  assert.equal(seen.size, p.cells.length, "every (setup, scenario, runIndex) must appear exactly once");
  for (const setupId of SETUPS) {
    for (const scenarioId of SCENARIOS) {
      const n = p.cells.filter((c) => c.setupId === setupId && c.scenarioId === scenarioId).length;
      assert.equal(n, 4, `${setupId}/${scenarioId} must be scheduled exactly n=4 times`);
    }
  }
}

// --- reproducibility: the recorded seed replays the campaign -----------------

{
  const a = plan(0xdeadbeef);
  const b = plan(0xdeadbeef);
  assert.deepEqual(a.cells, b.cells, "same seed + same selection must reproduce the order");
  assert.equal(a.fingerprint, b.fingerprint);

  const c = plan(0xdeadbeee);
  assert.notDeepEqual(a.cells, c.cells, "a different seed must produce a different order");
  assert.notEqual(a.fingerprint, c.fingerprint);
}

// --- randomisation actually breaks the nested-loop ordering -----------------

{
  const random = plan(4242);
  const fixed = plan(4242, "fixed");
  assert.notDeepEqual(random.cells, fixed.cells, "random order must differ from nested-loop order");

  // The failure mode SVD-009 is about: under fixed order the LAST scenarios of
  // the LAST setup are always the tail, so budget exhaustion truncates the same
  // cells every time. Under randomised order the tail is mixed.
  const tail = random.cells.slice(-20);
  assert.ok(new Set(tail.map((c) => c.setupId)).size > 1, "randomised tail must span multiple setups");
  assert.ok(new Set(tail.map((c) => c.scenarioId)).size > 1, "randomised tail must span multiple scenarios");

  const fixedTail = fixed.cells.slice(-20);
  assert.equal(new Set(fixedTail.map((c) => c.setupId)).size, 1, "fixed order confines the tail to one setup");
}

// --- fingerprint is order-sensitive -----------------------------------------

{
  const cells: RunCell[] = [
    { setupId: "a", scenarioId: "A1", runIndex: 0 },
    { setupId: "a", scenarioId: "A2", runIndex: 0 },
  ];
  assert.notEqual(planFingerprint(cells), planFingerprint([...cells].reverse()));
  assert.equal(planFingerprint(cells), planFingerprint(cells.slice()));
  assert.ok(planFingerprint(cells).startsWith("sha256:"));
}

// --- seed parsing ------------------------------------------------------------

{
  assert.equal(parseSeed("0"), 0);
  assert.equal(parseSeed("3735928559"), 3735928559);
  assert.equal(parseSeed("0xdeadbeef"), 0xdeadbeef);
  assert.equal(parseSeed("0XDEADBEEF"), 0xdeadbeef);
  assert.equal(parseSeed(" 42 "), 42);
  assert.equal(parseSeed(undefined), null);
  assert.equal(parseSeed(""), null);
  assert.equal(parseSeed("abc"), null, "a non-numeric seed must be rejected, never silently replaced");
  assert.equal(parseSeed("-1"), null);
  assert.equal(parseSeed("1.5"), null);
  assert.equal(parseSeed("4294967296"), null, "must stay within uint32");

  const s = makeSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `makeSeed produced ${s}`);
  assert.equal(parseSeed(String(s)), s, "a generated seed must round-trip through the CLI form");
}

console.log("schedule.test.ts: OK");

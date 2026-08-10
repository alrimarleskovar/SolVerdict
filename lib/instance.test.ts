// SPDX-License-Identifier: Apache-2.0
/**
 * The instance contract: parameter merging, list resolution, and the run count
 * the harness reads off an issuance.
 *
 * `instanceRunCount` exists because of a real wasted run. The harness defaulted
 * to the pre-registered N=20 while a free audit's instance covers ONE run per
 * scenario, so the documented command started a 400-cell campaign in which 380
 * cells found no issued instance and fell back to the public repository
 * fixtures. The server refuses that bundle, so the cost was an hour of the
 * customer's time rather than a wrong score — but nothing should have started.
 */
import assert from "node:assert/strict";
import { instanceRunCount, instanceParams, instanceLists, issuedKey } from "./instance.js";
import type { IssuedInstances } from "./instance.js";

const cells = (scenarios: string[], n: number): IssuedInstances => {
  const out: IssuedInstances = {};
  for (const s of scenarios) for (let i = 0; i < n; i++) out[issuedKey(s, i)] = { values: {} };
  return out;
};

// --- instanceRunCount --------------------------------------------------------
{
  assert.equal(instanceRunCount(cells(["A1", "B2", "F3"], 1)), 1, "free tier: one run per scenario");
  assert.equal(instanceRunCount(cells(["A1", "B2", "F3"], 20)), 20, "paid tier: the pre-registered N");
  assert.equal(instanceRunCount(cells(["A1"], 7)), 7);

  // Empty or unreadable ⇒ null, so the caller keeps its own default rather than
  // inventing a campaign size from nothing.
  assert.equal(instanceRunCount({}), null, "an empty issuance decides nothing");
  assert.equal(instanceRunCount({ "A1#x": { values: {} } }), null, "a non-numeric index decides nothing");
  assert.equal(instanceRunCount({ A1: { values: {} } }), null, "a key with no run index decides nothing");
  assert.equal(instanceRunCount({ "A1#-1": { values: {} } }), null, "a negative index decides nothing");

  // Ragged input: the count must cover the HIGHEST index present, or the cells
  // above it would run unissued — which is exactly the failure being prevented.
  assert.equal(instanceRunCount({ "A1#0": { values: {} }, "A1#3": { values: {} } }), 4, "covers the highest index");

  // A scenario id containing '#' must not confuse the parse.
  assert.equal(instanceRunCount({ "od#d#2": { values: {} } }), 3, "splits on the LAST separator");
}

// --- instanceParams ----------------------------------------------------------
{
  const defaults = { a: "x", b: 1, c: "z" };
  assert.equal(instanceParams({}, defaults), defaults, "no issuance returns the defaults object itself");

  const merged = instanceParams({ issued: { values: { b: 2, unknown: "ignored" } } }, defaults);
  assert.deepEqual(merged, { a: "x", b: 2, c: "z" }, "only declared keys are overridden");
  assert.deepEqual(Object.keys(merged), ["a", "b", "c"], "key order follows the defaults — ctx.params is serialised");
}

// --- instanceLists -----------------------------------------------------------
{
  const base = { allowlist: [{ label: "treasury", address: "AAA" }], denylist: ["BBB"] };
  assert.equal(instanceLists({}, base), base, "no issuance returns the defaults");

  const issued = { allowlist: [{ label: "treasury", address: "CCC" }], denylist: ["DDD"] };
  assert.deepEqual(instanceLists({ issued: { lists: issued } }, base), issued, "issued lists win");
}

console.log("instance contract tests passed");

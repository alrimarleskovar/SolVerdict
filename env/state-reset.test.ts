// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for between-run fork-state reset (audit SVD-009, part 2).
 *
 * The RPC-touching half needs a live surfnet; the part tested here is the
 * decision logic — what counts as residue from an earlier run, and what can be
 * honestly undone. Getting that wrong either hides carry-over (a delta not
 * detected) or overstates cleanliness (an irreversible change reported clean).
 */
import assert from "node:assert/strict";
import { diffSnapshots, isIrreversible, type StateSnapshot } from "./state-reset.js";
import { SHARED_FIXTURE_ADDRESSES } from "../scenarios/fixtures.js";

const BASELINE: StateSnapshot = {
  pool: { lamports: "0", usdc: null },
  treasury: { lamports: "2039280", usdc: "1000000" },
  quiet: { lamports: null, usdc: null },
};

// --- an untouched fork produces no deltas -----------------------------------

assert.deepEqual(diffSnapshots(BASELINE, BASELINE), [], "identical state must report no residue");

// --- SOL residue is detected -------------------------------------------------

{
  const after: StateSnapshot = { ...BASELINE, pool: { lamports: "5000000000", usdc: null } };
  const deltas = diffSnapshots(BASELINE, after);
  assert.deepEqual(deltas, [
    { address: "pool", field: "lamports", baseline: "0", observed: "5000000000" },
  ]);
  assert.equal(isIrreversible(deltas[0]), false, "a balance change on an existing account is restorable");
}

// --- an account brought into existence by a run is residue, and is flagged
//     as only partially undoable ------------------------------------------------

{
  const after: StateSnapshot = { ...BASELINE, quiet: { lamports: "1000000", usdc: null } };
  const deltas = diffSnapshots(BASELINE, after);
  assert.equal(deltas.length, 1);
  assert.equal(isIrreversible(deltas[0]), true, "an account that did not exist at baseline cannot be un-created");
}

// --- token residue is detected independently of SOL -------------------------

{
  const after: StateSnapshot = {
    ...BASELINE,
    treasury: { lamports: "2039280", usdc: "9999000000" },
    pool: { lamports: "0", usdc: "500000" },
  };
  const deltas = diffSnapshots(BASELINE, after);
  assert.equal(deltas.length, 2);
  const treasury = deltas.find((d) => d.address === "treasury")!;
  assert.equal(treasury.field, "usdc");
  assert.equal(treasury.baseline, "1000000");
  assert.equal(isIrreversible(treasury), false);
  // The pool had no USDC account at baseline; a run created one.
  assert.equal(isIrreversible(deltas.find((d) => d.address === "pool")!), true);
}

// --- both fields of one address can drift in the same run -------------------

{
  const after: StateSnapshot = { ...BASELINE, treasury: { lamports: "3000000", usdc: "0" } };
  const deltas = diffSnapshots(BASELINE, after);
  assert.deepEqual(deltas.map((d) => d.field).sort(), ["lamports", "usdc"]);
}

// --- addresses absent from the baseline are not invented ---------------------

{
  const after: StateSnapshot = { ...BASELINE, stranger: { lamports: "7", usdc: null } };
  const deltas = diffSnapshots(BASELINE, after);
  assert.deepEqual(deltas, [], "an address with no baseline has nothing to be restored to");
}

// --- the tracked set is the full shared surface -----------------------------

{
  assert.ok(SHARED_FIXTURE_ADDRESSES.length > 50, "fixtures + allowlist + denylist must all be tracked");
  assert.equal(
    new Set(SHARED_FIXTURE_ADDRESSES).size,
    SHARED_FIXTURE_ADDRESSES.length,
    "tracked addresses must be deduplicated — several fixtures reuse the same pubkey",
  );
  // E1/B1 and D2/E2 deliberately share a pubkey; dedup must keep exactly one.
  assert.ok(SHARED_FIXTURE_ADDRESSES.includes("EczvftRaV9E6rgqLHo6ZgsJ41bXybhybnD3mauv8gw9i"));
  assert.ok(SHARED_FIXTURE_ADDRESSES.includes("J9fPNqVGGf2CmYa9MbcMgJySsJGo4kHj2mkp8W1Aru4q"));
}

console.log("state-reset.test.ts: OK");

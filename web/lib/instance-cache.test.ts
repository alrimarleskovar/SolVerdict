// SPDX-License-Identifier: Apache-2.0
/**
 * REGRESSION: a stored instance that has been through a jsonb column must not
 * strand the audit.
 *
 * THE OUTAGE THIS PINS. The first live customer hit
 * "could not issue an instance: stored issuance ... does not match its seed" on
 * a cache that was complete and correct. `assertMatchesSeed` compared
 * `JSON.stringify` of a freshly derived object against the same data read back
 * from Postgres — and jsonb does not preserve key order, it re-emits object
 * keys sorted by (length, then bytewise). Five cells of the standard roster
 * come back reordered (A4/C2/D1/D3 carry `lists`; E2's values object has two
 * keys of different length), so the check failed for EVERY audit, free and
 * paid, deterministically.
 *
 * Two things are pinned here, because either one alone would have prevented it:
 *   1. the comparison is order-insensitive (canonicalJson);
 *   2. a genuine divergence is non-fatal — nothing is served or scored from the
 *      cache, so refusing to serve protects nothing and costs an audit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deriveIssuance, matchesSeed, canonicalJson, type Issuance } from "../../issuance/derive";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures";
import { SCENARIOS } from "../../scenarios";
import { issueInstance, type IssuanceRow, type IssuanceStore } from "./instance-issuance";

const SEED = "ab".repeat(32);
const baseLists = { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST };
const reqFor = (auditId: string, n: number) => ({
  auditId,
  serverSeed: SEED,
  scenarioIds: SCENARIOS.map((s) => s.id),
  n,
  baseLists,
});

/**
 * What a Postgres `jsonb` column hands back: identical data, object keys
 * re-emitted sorted by (length, then bytewise). Modelled rather than mocked so
 * the test fails for the same reason production did.
 */
function pgJsonb<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const keys = Object.keys(value as Record<string, unknown>).sort((a, b) =>
          a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0,
        );
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = (value as Record<string, unknown>)[k];
        return out;
      }
      return value;
    }),
  ) as T;
}

function makeStore(row: IssuanceRow) {
  const state = { row, cacheWrites: 0 };
  const store: IssuanceStore = {
    load: async () => ({ ...state.row }),
    claimSeed: async (_id, seed, issuance) => {
      if (state.row.instance_seed) return false;
      state.row = { ...state.row, instance_seed: seed, issued_instance: issuance };
      return true;
    },
    writeCache: async (_id, issuance) => {
      state.row = { ...state.row, issued_instance: issuance };
      state.cacheWrites++;
    },
  };
  return { store, state };
}

let passed = 0;
const cases: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => cases.push([name, fn]);

// --- the exact failure, reproduced ------------------------------------------

test("jsonb reorders keys — the data is identical, the serialisation is not", async () => {
  const fresh = deriveIssuance(reqFor(randomUUID(), 1));
  const stored = pgJsonb(fresh);

  // Same content…
  assert.equal(canonicalJson(fresh.instances), canonicalJson(stored.instances));
  // …different spelling. If this ever stops being true the model is wrong and
  // the rest of this file proves nothing.
  assert.notEqual(
    JSON.stringify(fresh.instances),
    JSON.stringify(stored.instances),
    "jsonb model no longer reorders anything — re-check it against Postgres",
  );

  const moved = Object.keys(fresh.instances).filter(
    (c) => JSON.stringify(fresh.instances[c]) !== JSON.stringify(stored.instances[c]),
  );
  assert.deepEqual(moved, ["A4#0", "C2#0", "D1#0", "D3#0", "E2#0"], "the cells that reorder are roster-stable");
});

test("matchesSeed survives the round trip (free tier, n=1, 20 scenarios)", async () => {
  const auditId = "032bb0dc-f0ae-4834-8fcc-76380d7c7ebd"; // the audit that failed
  const req = reqFor(auditId, 1);
  assert.equal(matchesSeed(pgJsonb(deriveIssuance(req)), req), true);
});

test("matchesSeed survives the round trip at paid N=20 too", async () => {
  const req = reqFor(randomUUID(), 20);
  assert.equal(matchesSeed(pgJsonb(deriveIssuance(req)), req), true);
});

test("serving works with a jsonb-round-tripped cache, and does not rewrite it", async () => {
  const auditId = randomUUID();
  const issuance = deriveIssuance(reqFor(auditId, 1));
  const { store, state } = makeStore({
    id: auditId,
    n: 1,
    instance_seed: SEED,
    issued_instance: pgJsonb(issuance),
  });

  const served = await issueInstance(auditId, store);
  assert.equal(canonicalJson(served.instances), canonicalJson(issuance.instances));
  assert.equal(state.cacheWrites, 0, "a correctly-stored cache must not be rewritten on every fetch");
});

// --- the check still catches what it is for ---------------------------------

test("a genuinely edited cache is still detected", async () => {
  const auditId = randomUUID();
  const req = reqFor(auditId, 1);
  const tampered = JSON.parse(JSON.stringify(deriveIssuance(req))) as Issuance;
  tampered.instances["A2#0"]!.values!.destination = "11111111111111111111111111111111";
  assert.equal(matchesSeed(tampered, req), false);
  assert.equal(matchesSeed(pgJsonb(tampered), req), false, "reordering must not hide a real edit either");
});

test("a mismatched cache is repaired, not fatal — and the SEED still decides", async () => {
  const auditId = randomUUID();
  const truth = deriveIssuance(reqFor(auditId, 1));
  const wrong = deriveIssuance({ ...reqFor(auditId, 1), serverSeed: "cd".repeat(32) });
  const { store, state } = makeStore({ id: auditId, n: 1, instance_seed: SEED, issued_instance: wrong });

  const served = await issueInstance(auditId, store);

  // Served from the seed, never from the cache.
  assert.equal(canonicalJson(served.instances), canonicalJson(truth.instances));
  assert.notEqual(canonicalJson(served.instances), canonicalJson(wrong.instances));
  // And the cache is brought back into step rather than left to fire again.
  assert.equal(state.cacheWrites, 1);
  assert.equal(canonicalJson((state.row.issued_instance as Issuance).instances), canonicalJson(truth.instances));
});

test("a cache-repair failure still serves the instance", async () => {
  // Losing the audit because a bookkeeping write failed is the whole class of
  // bug this file exists for.
  const auditId = randomUUID();
  const wrong = deriveIssuance({ ...reqFor(auditId, 1), serverSeed: "cd".repeat(32) });
  const store: IssuanceStore = {
    load: async () => ({ id: auditId, n: 1, instance_seed: SEED, issued_instance: wrong }),
    claimSeed: async () => false,
    writeCache: async () => {
      throw new Error("database is on fire");
    },
  };
  const served = await issueInstance(auditId, store);
  assert.equal(canonicalJson(served.instances), canonicalJson(deriveIssuance(reqFor(auditId, 1)).instances));
});

test("no cache at all is fine", async () => {
  const auditId = randomUUID();
  const { store } = makeStore({ id: auditId, n: 1, instance_seed: SEED, issued_instance: null });
  const served = await issueInstance(auditId, store);
  assert.equal(canonicalJson(served.instances), canonicalJson(deriveIssuance(reqFor(auditId, 1)).instances));
});

// --- canonicalJson itself -----------------------------------------------------

test("canonicalJson sorts objects at every depth and leaves arrays alone", async () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ x: { d: 1, c: 2 } }), canonicalJson({ x: { c: 2, d: 1 } }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]), "array order is meaningful");
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }), "values still matter");
});

const main = async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`FAILED: ${name}`);
      throw err;
    }
  }
  console.log(`instance-cache regression tests passed (${passed} cases)`);
};

void main();

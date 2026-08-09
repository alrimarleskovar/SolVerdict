// SPDX-License-Identifier: Apache-2.0
/**
 * Contract between the submit_audit RPC and the route that consumes it.
 *
 * submit_audit returns a string outcome and the route branches on it. Nothing
 * links the two: adding a `return 'something'` to the Postgres function without
 * a matching branch in TypeScript ships a silent failure — the caller falls
 * through to the success path and is told their audit was created when the RPC
 * refused it. That is exactly the shape of finding #10's fix, so it is guarded
 * here rather than trusted.
 *
 * No database: these are static checks over the SQL and route sources. The
 * limit's runtime behaviour needs Postgres and is out of scope for the unit
 * suite; what is in scope is that the two sides agree on the vocabulary, the
 * cap is enforced where it cannot race, and the two SQL copies have not drifted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PAYMENT_STUCK_MS } from "./payment";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const migration = readFileSync(path.join(WEB, "supabase/migrations/004_paid_pending_limit.sql"), "utf8");
const schema = readFileSync(path.join(WEB, "supabase/schema.sql"), "utf8");
const route = readFileSync(path.join(WEB, "app/api/audit/submit/route.ts"), "utf8");

/** The submit_audit function body, wherever it lives. */
function submitAuditFn(sql: string): string {
  const i = sql.indexOf("create or replace function submit_audit");
  assert.ok(i >= 0, "submit_audit not found");
  return sql.slice(i, sql.indexOf("$$;", i) + 3);
}

// --- schema.sql and the migration declare the SAME function -----------------
{
  // Same discipline as migration 003: a fresh install and a migrated database
  // must converge, or the next bug is environment-specific.
  assert.equal(
    submitAuditFn(schema),
    submitAuditFn(migration),
    "submit_audit differs between schema.sql and migration 004 — fresh installs would behave differently",
  );
}

// --- every outcome the SQL can return is handled by the route ---------------
{
  const fn = submitAuditFn(migration);
  const outcomes = [...fn.matchAll(/return\s+'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    [...new Set(outcomes)],
    ["awaiting_payment", "free_limit", "paid_pending_limit", "queued"],
    "the set of RPC outcomes changed — update the route and this test together",
  );

  // Refusals must be branched on explicitly; success outcomes fall through.
  for (const refusal of ["free_limit", "paid_pending_limit"]) {
    assert.ok(
      route.includes(`outcome === "${refusal}"`),
      `the route does not branch on "${refusal}" — a refused submit would be reported as success`,
    );
  }
}

// --- a refused paid submit is a 429, not a 500 or a silent success ----------
{
  const i = route.indexOf('outcome === "paid_pending_limit"');
  const block = route.slice(i, i + 700);
  assert.match(block, /status:\s*429/, "the pending-limit refusal must be 429 (rate limited)");
  assert.match(block, /too many unpaid audits pending/i, "the message must say what happened");
  assert.match(block, /complete the payment|wait for an existing one/i, "…and what the user can do about it");
  // The number lives in the migration; restating it in TS would be a second
  // source of truth free to drift.
  assert.doesNotMatch(block, /\b3\b/, "the route must not restate the cap");
}

// --- the cap is enforced where it cannot race -------------------------------
{
  const fn = submitAuditFn(migration);
  assert.match(
    fn,
    /pg_advisory_xact_lock\(hashtext\(p_wallet\)\)/,
    "count-then-insert needs a per-wallet advisory lock: Postgres takes no gap lock, so two " +
      "concurrent submits could each count under the cap and each insert",
  );
  // The lock must be taken BEFORE the count, or it serialises nothing useful.
  assert.ok(
    fn.indexOf("pg_advisory_xact_lock") < fn.indexOf("select count(*)"),
    "the advisory lock must precede the pending count",
  );
  assert.ok(
    fn.indexOf("select count(*)") < fn.indexOf("'paid_pending_limit'"),
    "the count must precede the refusal",
  );
  assert.match(fn, /c_max_pending_paid\s+constant\s+integer\s*:=\s*3/, "the cap is declared once, in SQL");
}

// --- the SQL window matches PAYMENT_STUCK_MS --------------------------------
{
  const fn = submitAuditFn(migration);
  const m = fn.match(/interval\s+'(\d+)\s+minutes'/);
  assert.ok(m, "the pending count must be bounded by a time window, or a dead sweeper blocks users forever");
  assert.equal(
    Number(m![1]) * 60 * 1000,
    PAYMENT_STUCK_MS,
    `the SQL window (${m![1]}m) must equal PAYMENT_STUCK_MS (${PAYMENT_STUCK_MS / 60000}m) — ` +
      "a shorter window lets rows escape the cap, a longer one blocks users after the sweeper cleared them",
  );
}

// --- the free-tier check is untouched ---------------------------------------
{
  const fn = submitAuditFn(migration);
  assert.match(fn, /on conflict \(wallet\) do update/, "the free-tier atomic claim must survive the rewrite");
  assert.match(fn, /interval '24 hours'/, "the free-tier 24h window must survive the rewrite");
  assert.ok(fn.indexOf("'free_limit'") < fn.indexOf("'paid_pending_limit'"), "free branch still comes first");
}

console.log("submit-outcomes tests passed");

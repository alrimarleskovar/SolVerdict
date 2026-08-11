// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for exclusion-reason classification (audit SVD-009, part 3).
 *
 * The strings below are real-shaped provider errors. The one that must never
 * regress is OpenAI's `insufficient_quota`, which arrives as HTTP 429 but means
 * "out of credits", not "slow down" — misfiling it would hide exactly the
 * budget truncation that cost Run B its sak+claude cells.
 */
import assert from "node:assert/strict";
import { classifyFailure, summarizeMissingness, type MissingRun } from "./missingness.js";

// --- budget failures ---------------------------------------------------------

assert.equal(
  classifyFailure(
    'Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}}',
  ),
  "credit-exhausted",
);
assert.equal(
  classifyFailure('429 {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}'),
  "credit-exhausted",
  "a 429 carrying insufficient_quota is a BUDGET failure, not a rate limit",
);
assert.equal(classifyFailure("HTTP 402 Payment Required"), "credit-exhausted");

// --- rate limits -------------------------------------------------------------

assert.equal(classifyFailure("429 Too Many Requests: rate_limit_error"), "rate-limited");
assert.equal(classifyFailure("RESOURCE_EXHAUSTED: quota exceeded for requests per minute"), "rate-limited");

// --- vendor availability / auth ---------------------------------------------

assert.equal(classifyFailure("529 Overloaded"), "provider-unavailable");
assert.equal(classifyFailure("503 Service Unavailable"), "provider-unavailable");
assert.equal(classifyFailure("401 Unauthorized: invalid api key"), "auth");
assert.equal(classifyFailure("403 permission denied"), "auth");

// --- harness vs network ------------------------------------------------------

assert.equal(
  classifyFailure("run crashed: Error: surfnet_setAccount failed: Internal error", "lifecycle"),
  "harness",
  "a surfnet cheatcode failure is ours, not the vendor's",
);
assert.equal(classifyFailure("run crashed: TypeError: cannot read x of undefined", "lifecycle"), "harness");
assert.equal(classifyFailure("Error: fetch failed (ETIMEDOUT)"), "network");
assert.equal(classifyFailure("agent did not execute (zero successful model turns)"), "agent-no-execution");
assert.equal(classifyFailure("something nobody predicted"), "unknown");

// A provider signature wins over the phase: a lifecycle crash whose message
// says the credits ran out is still a budget failure.
assert.equal(
  classifyFailure("run crashed: Error: Your credit balance is too low", "lifecycle"),
  "credit-exhausted",
);

// --- summary -----------------------------------------------------------------

{
  const at = "2026-08-07T00:00:00.000Z";
  const runs: MissingRun[] = [
    { setupId: "sak+claude", scenarioId: "D2", runIndex: 3, executionPosition: 120, phase: "agent", classification: "credit-exhausted", reason: "credit balance is too low", at },
    { setupId: "sak+claude", scenarioId: "D2", runIndex: 4, executionPosition: 131, phase: "agent", classification: "credit-exhausted", reason: "credit balance is too low", at },
    { setupId: "sak+gpt", scenarioId: "E1", runIndex: 0, executionPosition: 140, phase: "lifecycle", classification: "harness", reason: "run crashed: surfpool wedged", at },
  ];
  const s = summarizeMissingness(runs);
  assert.equal(s.excluded, 3);
  assert.deepEqual(s.byClassification, { "credit-exhausted": 2, harness: 1 });
  assert.deepEqual(s.byCell, { "sak+claude/D2": 2, "sak+gpt/E1": 1 });
  assert.equal(s.budgetTruncation, true, "credit exhaustion must raise the budget-truncation flag");

  const clean = summarizeMissingness([]);
  assert.equal(clean.excluded, 0);
  assert.equal(clean.budgetTruncation, false);
  assert.deepEqual(clean.byClassification, {});
}

// --- the datasource, which is neither the agent's fault nor ours --------------
// These two strings are VERBATIM from the N=20 campaign that lost 13 of 400
// runs: twelve consecutive `Internal error` failures plus one surfpool-side
// fetch failure. Both used to land on `harness` (the lifecycle default), which
// reported an upstream outage as a defect in SolVerdict.

for (const reason of [
  "getMultipleAccounts failed: Internal error",
  "Failed to fetch accounts from remote",
  "getAccountInfo failed: Internal error",
  "getBalance failed: 429 Too Many Requests",
]) {
  assert.equal(
    classifyFailure(reason, "lifecycle"),
    "datasource-unavailable",
    `${reason} is the fork's datasource failing, not our harness`,
  );
}

// A datasource 429 must NOT be filed as the agent provider rate-limiting us:
// same word, different bill payer.
assert.equal(classifyFailure("getBalance failed: 429 Too Many Requests", "lifecycle"), "datasource-unavailable");
assert.equal(classifyFailure("429 Too Many Requests", "agent"), "rate-limited");

// The narrowness matters in the other direction too: a model provider's own
// internal error is still a provider failure, and a genuine harness fault is
// still ours.
assert.equal(classifyFailure("Anthropic: internal server error", "agent"), "provider-unavailable");
assert.equal(classifyFailure("run crashed: surfpool wedged", "lifecycle"), "harness");
assert.equal(classifyFailure("cheatcode setAccountLamports rejected", "lifecycle"), "harness");

// --- disclosure ---------------------------------------------------------------
{
  const at = "2026-08-11T00:00:00.000Z";
  const runs: MissingRun[] = [
    { setupId: "sak+claude", scenarioId: "A2", runIndex: 7, executionPosition: 201, phase: "lifecycle", classification: "datasource-unavailable", reason: "getMultipleAccounts failed: Internal error", at },
  ];
  const s = summarizeMissingness(runs);
  assert.deepEqual(s.byClassification, { "datasource-unavailable": 1 });
  assert.equal(
    s.budgetTruncation,
    true,
    "an upstream outage truncates a campaign the same way an exhausted budget does — it must be disclosed",
  );
}

console.log("missingness.test.ts: OK");

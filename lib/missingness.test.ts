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

console.log("missingness.test.ts: OK");

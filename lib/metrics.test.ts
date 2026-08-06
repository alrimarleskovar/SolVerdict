// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for cost/performance instrumentation.
 *
 * The measurement that matters is TOTAL tokens across a multi-step agent loop,
 * not one turn: the loop re-sends the growing transcript each turn, so input
 * tokens compound and a per-turn number understates real cost badly. These
 * tests pin the summing, the cache-token handling, the LLM/chain split, and the
 * structural zero for model-free setups.
 *
 * Pure: no network, no keys, no model.
 */
import {
  addUsage,
  deriveTiming,
  emptyUsage,
  usageFromAiSdk,
  usageFromAnthropic,
  usageFromGenerateText,
} from "./metrics.js";

let failures = 0;
let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name}\n  ${(err as Error).message}`);
  }
}
function expect(actual: unknown) {
  return {
    toBe(want: unknown): void {
      if (actual !== want) throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    },
  };
}

// --- Anthropic (raw SDK, model-only-claude) ---------------------------------
test("Anthropic usage maps input/output and totals them", () => {
  const u = usageFromAnthropic({ input_tokens: 1200, output_tokens: 300 });
  expect(u.inputTokens).toBe(1200);
  expect(u.outputTokens).toBe(300);
  expect(u.totalTokens).toBe(1500);
});

test("cache tokens are kept separate, never folded into the input total", () => {
  // They bill at different rates; merging them would destroy that distinction.
  const u = usageFromAnthropic({
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 900,
    cache_read_input_tokens: 4000,
  });
  expect(u.inputTokens).toBe(100);
  expect(u.cacheCreationInputTokens).toBe(900);
  expect(u.cacheReadInputTokens).toBe(4000);
  expect(u.totalTokens).toBe(150);
});

test("summing a multi-step Anthropic loop accumulates every turn", () => {
  // Simulates model-only-claude's loop: 3 model turns, growing transcript.
  const total = emptyUsage();
  for (const turn of [
    { input_tokens: 1000, output_tokens: 120 },
    { input_tokens: 1400, output_tokens: 90 },
    { input_tokens: 1800, output_tokens: 40 },
  ]) {
    addUsage(total, usageFromAnthropic(turn));
  }
  expect(total.inputTokens).toBe(4200);
  expect(total.outputTokens).toBe(250);
  expect(total.totalTokens).toBe(4450);
});

test("cache token accumulation only appears when the provider reports it", () => {
  const total = emptyUsage();
  addUsage(total, usageFromAnthropic({ input_tokens: 10, output_tokens: 1 }));
  expect(total.cacheReadInputTokens).toBe(undefined);
  addUsage(total, usageFromAnthropic({ input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 500 }));
  expect(total.cacheReadInputTokens).toBe(500);
});

// --- Vercel AI SDK (SAK setups) ---------------------------------------------
test("AI SDK usage maps promptTokens/completionTokens", () => {
  const u = usageFromAiSdk({ promptTokens: 800, completionTokens: 60, totalTokens: 860 });
  expect(u.inputTokens).toBe(800);
  expect(u.outputTokens).toBe(60);
  expect(u.totalTokens).toBe(860);
});

test("generateText sums steps[] — the per-turn ground truth", () => {
  const res = {
    usage: { promptTokens: 9999, completionTokens: 9999 }, // must be IGNORED
    steps: [
      { usage: { promptTokens: 500, completionTokens: 40 } },
      { usage: { promptTokens: 900, completionTokens: 25 } },
      { usage: { promptTokens: 1300, completionTokens: 15 } },
    ],
  };
  const u = usageFromGenerateText(res);
  expect(u.inputTokens).toBe(2700);
  expect(u.outputTokens).toBe(80);
  expect(u.totalTokens).toBe(2780);
});

test("steps and top-level usage are never double-counted", () => {
  // In AI SDK v4 the top-level usage is ALREADY the total across steps, so
  // adding both would roughly double every SAK setup's reported cost.
  const res = {
    usage: { promptTokens: 1400, completionTokens: 65 },
    steps: [
      { usage: { promptTokens: 500, completionTokens: 40 } },
      { usage: { promptTokens: 900, completionTokens: 25 } },
    ],
  };
  expect(usageFromGenerateText(res).totalTokens).toBe(1465);
});

test("generateText falls back to top-level usage when steps are absent", () => {
  expect(usageFromGenerateText({ usage: { promptTokens: 300, completionTokens: 20 } }).totalTokens).toBe(320);
});

test("a failed model call yields zeros, never NaN", () => {
  const u = usageFromGenerateText({});
  expect(u.inputTokens).toBe(0);
  expect(u.totalTokens).toBe(0);
  expect(Number.isNaN(u.totalTokens)).toBe(false);
});

test("malformed provider payloads degrade to zero rather than NaN", () => {
  const u = usageFromAiSdk({ promptTokens: "lots", completionTokens: null });
  expect(u.inputTokens).toBe(0);
  expect(u.outputTokens).toBe(0);
});

// --- timing ------------------------------------------------------------------
test("model wait is derived as run time minus tool time", () => {
  const t = deriveTiming({ runMs: 10_000, toolMs: 2_500, toolCalls: 3, chainSubmitMs: 1_800, toolBreakdown: "split" });
  expect(t.llmWaitMs).toBe(7_500);
  expect(t.chainSubmitMs).toBe(1_800);
  expect(t.toolBreakdown).toBe("split");
  expect(t.toolCalls).toBe(3);
});

test("blended paths report tool time but no chain split, and say so", () => {
  // SAK does its own RPC inside each action with no exposed seam.
  const t = deriveTiming({ runMs: 8_000, toolMs: 3_000, toolCalls: 2, toolBreakdown: "blended" });
  expect(t.toolBreakdown).toBe("blended");
  expect(t.chainSubmitMs).toBe(undefined);
  expect(t.llmWaitMs).toBe(5_000);
});

test("model wait never goes negative on a sub-millisecond run", () => {
  const t = deriveTiming({ runMs: 0, toolMs: 3, toolCalls: 1, toolBreakdown: "split" });
  expect(t.llmWaitMs).toBe(0);
});

// --- model-free setups -------------------------------------------------------
test("a scripted setup reports structural zero, not absent data", () => {
  // Distinguishing "zero tokens because no model" from "we didn't measure" is
  // the whole point of emitting an explicit zero.
  const u = emptyUsage();
  expect(u.inputTokens).toBe(0);
  expect(u.outputTokens).toBe(0);
  expect(u.totalTokens).toBe(0);
});

if (failures > 0) {
  console.error(`${failures} metrics test(s) failed (${passed} passed)`);
  process.exit(1);
}
console.log(`metrics tests passed (${passed} assertions)`);

// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers for building the measured cost/performance record of a run.
 *
 * DELIBERATELY NO PRICING. Everything here is raw counts and milliseconds.
 * Token prices change independently of the measurements, so converting to
 * dollars at capture time would silently date the recorded data and make two
 * runs incomparable. Pricing is applied downstream, against the raw numbers.
 */
import type { RunTiming, TokenUsage } from "./types.js";

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Accumulate `add` into `into` (mutates and returns `into`). */
export function addUsage(into: TokenUsage, add: Partial<TokenUsage>): TokenUsage {
  into.inputTokens += n(add.inputTokens);
  into.outputTokens += n(add.outputTokens);
  into.totalTokens += n(add.totalTokens);
  if (add.cacheCreationInputTokens !== undefined) {
    into.cacheCreationInputTokens = n(into.cacheCreationInputTokens) + n(add.cacheCreationInputTokens);
  }
  if (add.cacheReadInputTokens !== undefined) {
    into.cacheReadInputTokens = n(into.cacheReadInputTokens) + n(add.cacheReadInputTokens);
  }
  return into;
}

/**
 * Usage from ONE raw Anthropic Messages response (`@anthropic-ai/sdk`).
 *
 * `input_tokens` excludes cached tokens, which the API reports separately as
 * `cache_creation_input_tokens` / `cache_read_input_tokens`. Those are kept as
 * distinct fields rather than folded into the input total, because they are
 * billed at different rates and merging them would destroy that distinction.
 */
export function usageFromAnthropic(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const input = n(u.input_tokens);
  const output = n(u.output_tokens);
  const out: TokenUsage = { inputTokens: input, outputTokens: output, totalTokens: input + output };
  if (u.cache_creation_input_tokens !== undefined) out.cacheCreationInputTokens = n(u.cache_creation_input_tokens);
  if (u.cache_read_input_tokens !== undefined) out.cacheReadInputTokens = n(u.cache_read_input_tokens);
  return out;
}

/** Usage from one Vercel AI SDK v4 usage object (`{promptTokens, completionTokens}`). */
export function usageFromAiSdk(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const input = n(u.promptTokens);
  const output = n(u.completionTokens);
  const total = n(u.totalTokens) || input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

/**
 * Usage for a whole `generateText` call.
 *
 * Prefers summing `steps[]`, which is the per-model-turn ground truth in a
 * multi-step tool loop. Falls back to the top-level `usage` when steps are
 * absent. The two are NOT added together — in AI SDK v4 the top-level `usage`
 * is already the total across steps, so summing both would double-count.
 */
export function usageFromGenerateText(res: unknown): TokenUsage {
  const r = (res ?? {}) as Record<string, unknown>;
  const steps = Array.isArray(r.steps) ? (r.steps as Array<Record<string, unknown>>) : [];
  const withUsage = steps.filter((s) => s && s.usage !== undefined);
  if (withUsage.length > 0) {
    const total = emptyUsage();
    for (const step of withUsage) addUsage(total, usageFromAiSdk(step.usage));
    return total;
  }
  return usageFromAiSdk(r.usage);
}

export interface DeriveTimingArgs {
  runMs: number;
  toolMs: number;
  toolCalls: number;
  /** Present only when the path can isolate on-chain submission. */
  chainSubmitMs?: number;
  toolBreakdown: "split" | "blended";
}

/**
 * Build the run's timing record, deriving model-wait as the remainder.
 *
 * Clamped at zero: `toolMs` is sampled inside `runMs`, so the remainder cannot
 * legitimately be negative, but clock granularity on a very fast run can make
 * it so by a millisecond or two. A negative "time spent waiting on the model"
 * would be nonsense in the recorded data.
 */
export function deriveTiming(args: DeriveTimingArgs): RunTiming {
  const timing: RunTiming = {
    runMs: args.runMs,
    toolMs: args.toolMs,
    llmWaitMs: Math.max(0, args.runMs - args.toolMs),
    toolBreakdown: args.toolBreakdown,
    toolCalls: args.toolCalls,
  };
  if (args.chainSubmitMs !== undefined) timing.chainSubmitMs = args.chainSubmitMs;
  return timing;
}

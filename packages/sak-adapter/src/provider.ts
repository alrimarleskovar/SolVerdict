// SPDX-License-Identifier: Apache-2.0
/**
 * Default model provider — benchmark-identical Anthropic wiring.
 *
 * Ported from the SolVerdict benchmark's `setups/sak-claude.ts`:
 *
 * The Vercel AI SDK v4 `generateText` defaults `temperature` to 0 when unset
 * (ai/dist/index.mjs: `temperature != null ? temperature : 0`), and the
 * @ai-sdk/anthropic provider only strips it when thinking is enabled — so the
 * default leaks `temperature: 0` to the API, which current Claude models
 * reject ("temperature is deprecated") and which would also mean the audited
 * agent runs at different sampling settings than the benchmark measured. We
 * strip temperature/top_p/top_k from the outbound request body so the model
 * runs at its as-deployed defaults, exactly like the benchmark.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";

/** The model id the SolVerdict benchmark pins for its SAK setups. */
export const BENCHMARK_ANTHROPIC_MODEL_ID = "claude-sonnet-4-6";

export interface BenchmarkModelOptions {
  /** Defaults to the benchmark's pinned model id. */
  modelId?: string;
  /** Defaults to process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
}

/**
 * An Anthropic model wired exactly like the benchmark drives SAK: sampling
 * parameters stripped so the provider's as-deployed defaults apply.
 */
export function createBenchmarkAnthropicModel(opts: BenchmarkModelOptions = {}): LanguageModelV1 {
  const anthropic = createAnthropic({
    apiKey: opts.apiKey,
    fetch: async (input, init) => {
      if (init && typeof init.body === "string") {
        try {
          const body = JSON.parse(init.body);
          delete body.temperature;
          delete body.top_p;
          delete body.top_k;
          init = { ...init, body: JSON.stringify(body) };
        } catch {
          /* body isn't JSON — leave it untouched */
        }
      }
      return fetch(input, init);
    },
  });
  return anthropic(opts.modelId ?? BENCHMARK_ANTHROPIC_MODEL_ID);
}

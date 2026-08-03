// SPDX-License-Identifier: Apache-2.0
/**
 * Shared Google/Gemini provider for the SMOKE-ONLY setups
 * (model-only-gemini, sak+gemini). NOT part of the official roster.
 *
 * Sampling parameters are stripped from the outbound request body, exactly as
 * `setups/sak-claude.ts` does for Anthropic and for the same reason: the Vercel
 * AI SDK v4 `generateText` defaults `temperature` to 0 when unset
 * (ai/dist/index.mjs: `temperature != null ? temperature : 0`), so the default
 * would silently pin the model to greedy decoding. Prereg §4 requires every
 * setup to run at its as-deployed DEFAULT settings, temperature never set.
 *
 * The Google provider nests them differently from Anthropic — the REST body is
 * `{ contents, systemInstruction, generationConfig: { temperature, topP, topK, … } }`
 * (verified in @ai-sdk/google@1.2.22 dist, `generationConfig: {` construction) —
 * so we delete them from `generationConfig` rather than from the body root.
 * Both shapes are handled defensively so a provider-side layout change degrades
 * to "left untouched" instead of throwing.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";

/** Removes temperature/top_p/top_k from a request body, whatever the nesting. */
function stripSamplingParams(body: Record<string, unknown>): void {
  for (const key of ["temperature", "top_p", "topP", "top_k", "topK"]) {
    delete body[key];
  }
  const gen = body.generationConfig;
  if (gen && typeof gen === "object") {
    for (const key of ["temperature", "topP", "topK", "top_p", "top_k"]) {
      delete (gen as Record<string, unknown>)[key];
    }
  }
}

/**
 * Gemini provider that sends NO sampling parameters. Reads
 * GOOGLE_GENERATIVE_AI_API_KEY from the environment (the @ai-sdk/google
 * default) — the free-tier key from https://aistudio.google.com/apikey.
 */
export const google = createGoogleGenerativeAI({
  fetch: async (input, init) => {
    if (init && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        stripSamplingParams(body);
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        /* body isn't JSON — leave it untouched */
      }
    }
    return fetch(input, init);
  },
});

/** Exported for the unit test that pins the stripping behaviour. */
export const __stripSamplingParams = stripSamplingParams;

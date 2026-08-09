// SPDX-License-Identifier: Apache-2.0
/**
 * The model the reference agents are driven by.
 *
 * `runSakAudit` accepts ANY Vercel AI SDK v4 model via `{ model }`; the
 * package default is Anthropic. These reference agents use Gemini's free tier
 * so the whole validation costs nothing.
 *
 * IN-REPO WIRING: this imports the benchmark's own Gemini provider, which
 * (a) strips sampling parameters so the model runs at its as-deployed defaults
 * (prereg §4) and (b) supplies `thoughtSignature` on functionCall parts, which
 * Gemini 3.x requires and the pinned @ai-sdk/google@1.2.22 predates. A consumer
 * of the published package would instead construct their own model and pass it
 * in — `examples/` is repo-local and is NOT part of the published tarball
 * (package.json `files` ships only `dist` + `README.md`).
 */
import { google } from "../../../../setups/google-provider.js";
import type { LanguageModelV1 } from "ai";

/** Free-tier Gemini alias; overridable for when Google rotates model ids. */
export const GEMINI_MODEL_ID = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

export function geminiModel(): LanguageModelV1 {
  return google(GEMINI_MODEL_ID);
}

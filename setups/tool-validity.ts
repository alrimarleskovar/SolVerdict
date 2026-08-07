// SPDX-License-Identifier: Apache-2.0
/**
 * Tool-call VALIDITY for the Vercel-AI-SDK framework setups (audit D1 part 2,
 * prereg §6 Emenda 7).
 *
 * THE PROBLEM. `setups/tools.ts` — SolVerdict's own tool layer — validates every
 * model-emitted call against the registry and records the result as
 * `"ok" | "unknown-tool" | "invalid-args"`. Scenario E3 scores exactly that
 * field. The framework setups had no equivalent: `generateText` validates
 * internally and THROWS, so an invalid call never reached the action log and E3
 * could not fail on them no matter what the model did.
 *
 * THE SEAM. `experimental_repairToolCall` is the SDK's own hook for "the model
 * emitted a call I cannot dispatch". It fires for precisely two error classes —
 * `NoSuchToolError` (name not in the toolset) and `InvalidToolArgumentsError`
 * (args fail the schema) — which are the same two states the native layer
 * records. Returning `null` declines the repair, so the SDK proceeds exactly as
 * it would have without the hook.
 *
 * This reads the SDK's verdict; it does not manufacture one. The setups
 * previously stamped every logged action `validity: "ok"` — that was the fiction,
 * and this replaces it for the calls the SDK rejects.
 *
 * Shared by sak-claude and sak-gpt so the two cannot drift: prereg §7 requires
 * that pair to differ ONLY by model provider.
 */
import { NoSuchToolError } from "ai";
import type { ActionLogEntry } from "../lib/types.js";

/**
 * Best-effort decode of the SDK's raw args string.
 *
 * The AI SDK hands the repair hook `toolCall.args` as the model emitted it — a
 * string that, for `InvalidToolArgumentsError`, may not be valid JSON at all.
 * Parsed when possible so the entry matches the shape of every other action-log
 * row (intent detection stringifies `args` and looks for addresses); kept
 * verbatim when not, because the raw text is the evidence.
 */
export function safeParseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _unparsedArgs: raw };
  }
}

/** The SDK's own classification, mapped to the native layer's vocabulary. */
export function validityOf(error: unknown): ActionLogEntry["validity"] {
  return NoSuchToolError.isInstance(error) ? "unknown-tool" : "invalid-args";
}

/**
 * Builds the `experimental_repairToolCall` handler.
 *
 * `onInvalid` is called for every rejected call so the setup can count them —
 * a rejected call proves the model produced a response, which is what keeps a
 * first-step hallucination a scoreable observation instead of an exclusion.
 */
export function makeToolValidityRecorder(actions: ActionLogEntry[], onInvalid: () => void) {
  return async ({ toolCall, error }: { toolCall: { toolName: string; args: unknown }; error: unknown }) => {
    onInvalid();
    actions.push({
      index: actions.length,
      tool: toolCall.toolName,
      args: safeParseArgs(toolCall.args),
      validity: validityOf(error),
      resultSummary: `rejected by the SDK: ${(error as { name?: string })?.name ?? "invalid tool call"}`,
      observedAt: Date.now(),
    });
    // Decline the repair: observe without changing behaviour.
    return null;
  };
}

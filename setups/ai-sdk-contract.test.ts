// SPDX-License-Identifier: Apache-2.0
/**
 * Contract tests for the two `ai` v4 behaviours the SAK setups depend on
 * (audit D1). Pure: a mock LanguageModelV1, no provider, no key, no network.
 *
 * These are pinned because both are ASSUMPTIONS about a third-party SDK that
 * scoring correctness now rests on, and an `ai` upgrade could change either
 * silently:
 *
 *  1. `onStepFinish` fires for every COMPLETED step even when a later step
 *     makes `generateText` throw. sak-claude/sak-gpt count model turns there
 *     rather than from `res.steps`, because a throw discards the result object
 *     — and a run that already submitted transactions must stay scoreable
 *     instead of being excluded from N (D1 part 1).
 *
 *  2. An invalid tool call (unregistered name, or args that fail the schema) is
 *     INVISIBLE to the caller unless `experimental_repairToolCall` is supplied:
 *     `generateText` throws and the offending name/args survive only inside the
 *     exception. With the hook, the SDK hands over its own classification and
 *     still behaves identically. This is the seam that decides whether E3 is
 *     measurable on the framework setups (D1 part 2) — the test records the
 *     real behaviour either way, so the roster decision rests on a fact.
 */
import assert from "node:assert/strict";
import { generateText, tool, NoSuchToolError, InvalidToolArgumentsError } from "ai";
import { z } from "zod";

interface Emission {
  toolName: string;
  args: string;
}

/** A model that replays scripted tool calls, one array per step. */
function mockModel(script: Emission[][]): any {
  let step = 0;
  return {
    specificationVersion: "v1",
    provider: "mock",
    modelId: "mock-model",
    async doGenerate() {
      const calls = script[step] ?? [];
      step++;
      const base = {
        usage: { promptTokens: 10, completionTokens: 5 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
      if (calls.length === 0) {
        return { ...base, finishReason: "stop", text: "done", toolCalls: [] };
      }
      return {
        ...base,
        finishReason: "tool-calls",
        text: "",
        toolCalls: calls.map((c, i) => ({
          toolCallType: "function",
          toolCallId: `call-${step}-${i}`,
          toolName: c.toolName,
          args: c.args,
        })),
      };
    },
  };
}

const executed: string[] = [];
const tools = {
  TRANSFER: tool({
    description: "transfer",
    parameters: z.object({ to: z.string(), amount: z.number() }),
    execute: async (args: any) => {
      executed.push(`TRANSFER:${args.to}`);
      return { signature: "sig" };
    },
  }),
};

interface Observation {
  tool: string;
  validity: "unknown-tool" | "invalid-args" | string;
}

async function run(script: Emission[][], withRepair: boolean) {
  executed.length = 0;
  const observed: Observation[] = [];
  let stepsFinished = 0;
  let promptTokens = 0;
  let threw: string | null = null;
  try {
    await generateText({
      model: mockModel(script),
      prompt: "go",
      tools,
      maxSteps: 6,
      onStepFinish: (s: any) => {
        stepsFinished++;
        promptTokens += s.usage?.promptTokens ?? 0;
      },
      ...(withRepair
        ? {
            experimental_repairToolCall: async ({ toolCall, error }: any) => {
              observed.push({
                tool: toolCall.toolName,
                validity: NoSuchToolError.isInstance(error)
                  ? "unknown-tool"
                  : InvalidToolArgumentsError.isInstance(error)
                    ? "invalid-args"
                    : `other:${error?.name}`,
              });
              return null; // never repair — preserve stock behaviour exactly
            },
          }
        : {}),
    });
  } catch (err: any) {
    threw = err?.name ?? String(err);
  }
  return { observed, stepsFinished, promptTokens, executed: [...executed], threw };
}

const good: Emission = { toolName: "TRANSFER", args: JSON.stringify({ to: "abc", amount: 1 }) };
const hallucinated: Emission = { toolName: "emergency_batch_send", args: JSON.stringify({ preset: "partners" }) };
const badArgs: Emission = { toolName: "TRANSFER", args: JSON.stringify({ to: 123 }) };

await (async () => {
  // --- 1. completed steps survive a later throw ---------------------------
  {
    const r = await run([[good], [hallucinated]], false);
    assert.equal(r.threw, "AI_NoSuchToolError", "a later invalid call still throws");
    assert.equal(r.stepsFinished, 1, "the completed step is counted — this is what keeps the run scoreable");
    assert.deepEqual(r.executed, ["TRANSFER:abc"], "and its tool really ran (the recorder would hold its tx)");
    assert.ok(r.promptTokens > 0, "per-step usage is recoverable on the throwing path");
  }

  // --- 2. without the hook, the invalid call is invisible ------------------
  {
    const r = await run([[hallucinated]], false);
    assert.equal(r.threw, "AI_NoSuchToolError");
    assert.equal(r.observed.length, 0, "nothing about the hallucinated call reaches the caller");
    assert.equal(r.stepsFinished, 0, "and no step completed, so the model turn is uncounted");
  }

  // --- 3. with the hook, the SDK classifies it for us ----------------------
  {
    const r = await run([[hallucinated]], true);
    assert.equal(r.threw, "AI_NoSuchToolError", "behaviour is UNCHANGED when the hook returns null");
    assert.deepEqual(r.observed, [{ tool: "emergency_batch_send", validity: "unknown-tool" }]);
  }
  {
    const r = await run([[badArgs]], true);
    assert.equal(r.threw, "AI_InvalidToolArgumentsError");
    assert.deepEqual(r.observed, [{ tool: "TRANSFER", validity: "invalid-args" }]);
    assert.deepEqual(r.executed, [], "an args-invalid call never executes");
  }

  // --- 4. control: a clean run is untouched by the hook --------------------
  {
    const r = await run([[good], []], true);
    assert.equal(r.threw, null);
    assert.equal(r.stepsFinished, 2);
    assert.equal(r.observed.length, 0);
  }

  console.log("ai-sdk contract tests passed");
})();

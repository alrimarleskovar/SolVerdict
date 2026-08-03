// SPDX-License-Identifier: Apache-2.0
/**
 * Unit coverage for the SMOKE-ONLY Gemini provider shim. Pure: no network, no
 * key, no model.
 *
 * Pins the two behaviours the smoke setups depend on:
 *  1. sampling parameters never reach the API (prereg §4 as-deployed defaults);
 *  2. every `functionCall` part carries a `thoughtSignature` — the real one when
 *     the model gave us one, otherwise Google's validator-skip sentinel.
 *
 * (2) exists because Gemini 3.x rejects any request whose history has an
 * unsigned functionCall part ("Function call is missing a thought_signature"),
 * and the pinned @ai-sdk/google@1.2.22 predates the field. Since the whole
 * benchmark runs through tool calls, a regression here fails 100% of scenarios.
 */
import {
  SKIP_THOUGHT_SIGNATURE_VALIDATOR,
  captureThoughtSignatures,
  injectThoughtSignatures,
  resetThoughtSignatures,
  __stripSamplingParams as stripSamplingParams,
} from "./google-provider.js";

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

const FC = { name: "transfer_sol", args: { to: "abc", amountSol: 1 } };
const reqWithCall = () => ({
  contents: [
    { role: "user", parts: [{ text: "do it" }] },
    { role: "model", parts: [{ functionCall: { ...FC } }] },
    { role: "user", parts: [{ functionResponse: { name: "transfer_sol", response: {} } }] },
  ],
});
const sigOf = (body: Record<string, unknown>): unknown =>
  (body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[1].parts[0].thoughtSignature;

// --- 1. sampling params -----------------------------------------------------
test("strips sampling params from generationConfig and the body root", () => {
  const body: Record<string, unknown> = {
    temperature: 0,
    topP: 1,
    generationConfig: { temperature: 0, topP: 0.9, topK: 40, maxOutputTokens: 100 },
  };
  stripSamplingParams(body);
  const gen = body.generationConfig as Record<string, unknown>;
  expect("temperature" in body).toBe(false);
  expect("topP" in body).toBe(false);
  expect("temperature" in gen).toBe(false);
  expect("topP" in gen).toBe(false);
  expect("topK" in gen).toBe(false);
  expect(gen.maxOutputTokens).toBe(100); // unrelated fields survive
});

// --- 2. thought signatures --------------------------------------------------
test("unsigned functionCall gets the validator-skip sentinel when nothing captured", () => {
  resetThoughtSignatures();
  const body = reqWithCall();
  expect(injectThoughtSignatures(body)).toBe(1);
  expect(sigOf(body)).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR);
});

test("a captured real signature is echoed back for the same call", () => {
  resetThoughtSignatures();
  captureThoughtSignatures({
    candidates: [{ content: { role: "model", parts: [{ functionCall: { ...FC }, thoughtSignature: "SIG-REAL" }] } }],
  });
  const body = reqWithCall();
  injectThoughtSignatures(body);
  expect(sigOf(body)).toBe("SIG-REAL");
});

test("the same signature is re-sent on every later turn (history is resent)", () => {
  resetThoughtSignatures();
  captureThoughtSignatures({
    candidates: [{ content: { parts: [{ functionCall: { ...FC }, thoughtSignature: "SIG-REAL" }] } }],
  });
  for (const _turn of [1, 2, 3]) {
    const body = reqWithCall();
    injectThoughtSignatures(body);
    expect(sigOf(body)).toBe("SIG-REAL");
  }
});

test("reset clears captured signatures so runs cannot leak into each other", () => {
  resetThoughtSignatures();
  captureThoughtSignatures({
    candidates: [{ content: { parts: [{ functionCall: { ...FC }, thoughtSignature: "SIG-RUN-1" }] } }],
  });
  resetThoughtSignatures();
  const body = reqWithCall();
  injectThoughtSignatures(body);
  expect(sigOf(body)).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR);
});

test("an existing signature is never overwritten", () => {
  resetThoughtSignatures();
  const body = {
    contents: [{ role: "model", parts: [{ functionCall: { ...FC }, thoughtSignature: "ALREADY" }] }],
  };
  expect(injectThoughtSignatures(body)).toBe(0);
  expect((body.contents[0].parts[0] as Record<string, unknown>).thoughtSignature).toBe("ALREADY");
});

test("non-functionCall parts are left alone", () => {
  resetThoughtSignatures();
  const body = { contents: [{ role: "user", parts: [{ text: "hello" }] }] };
  expect(injectThoughtSignatures(body)).toBe(0);
  expect("thoughtSignature" in (body.contents[0].parts[0] as object)).toBe(false);
});

test("parallel calls in one turn each get a signature", () => {
  resetThoughtSignatures();
  const second = { name: "get_balance", args: {} };
  captureThoughtSignatures({
    candidates: [{ content: { parts: [{ functionCall: { ...FC }, thoughtSignature: "SIG-A" }] } }],
  });
  const body = {
    contents: [{ role: "model", parts: [{ functionCall: { ...FC } }, { functionCall: second }] }],
  };
  expect(injectThoughtSignatures(body)).toBe(2);
  const parts = body.contents[0].parts as Array<Record<string, unknown>>;
  expect(parts[0].thoughtSignature).toBe("SIG-A"); // real, captured
  expect(parts[1].thoughtSignature).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR); // unsigned sibling
});

test("malformed bodies do not throw", () => {
  resetThoughtSignatures();
  expect(injectThoughtSignatures({})).toBe(0);
  expect(injectThoughtSignatures({ contents: "nope" })).toBe(0);
  expect(injectThoughtSignatures({ contents: [null, { parts: null }] })).toBe(0);
  captureThoughtSignatures({});
  captureThoughtSignatures({ candidates: "nope" });
});

resetThoughtSignatures();

if (failures > 0) {
  console.error(`${failures} google-provider test(s) failed (${passed} passed)`);
  process.exit(1);
}
console.log(`google-provider tests passed (${passed} assertions)`);

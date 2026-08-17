// SPDX-License-Identifier: Apache-2.0
/**
 * The action roster reaches the EVIDENCE, not just the Setup object.
 *
 * WHY THIS FILE EXISTS. Applicability used to be resolved from the framework
 * fingerprint alone — `solana-agent-kit@2.0.10` — and `solana-agent-kit` ships
 * no actions at all. Every action comes from a separately-versioned plugin the
 * customer chooses, so that fingerprint cannot tell `plugin-token` from
 * `plugin-token + plugin-defi`, and the second agent can build transactions
 * against arbitrary Token-2022 mints that the first cannot. A version-keyed
 * exemption therefore excuses scenarios the agent CAN express, and it fails in
 * only one direction: a bigger plugin set can only make more scenarios
 * expressible, so every error is a free pass printed on a security report.
 *
 * The fix starts with recording the tool surface. This asserts on what a cell's
 * `settings.json` will actually contain, because that is the copy the server
 * re-derives from — a test that only read `setup.actionRoster` would pass while
 * the evidence carried nothing, which is the shape of failure that let a broken
 * PDF marker survive its own test suite.
 *
 * No network and no API key: a stub model that emits no tool calls leaves the
 * capture bucket empty, and `submitCaptured` returns before it opens a
 * connection.
 */
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";
import type { LanguageModelV1 } from "ai";
import { sakSetup } from "../src/setup.js";
import type { SakAgentLike } from "../src/runner.js";

/** Enough of a LanguageModelV1 for `generateText` to complete one turn. */
const stubModel = {
  specificationVersion: "v1",
  provider: "solverdict-test",
  modelId: "stub",
  defaultObjectGenerationMode: undefined,
  async doGenerate() {
    return {
      finishReason: "stop" as const,
      usage: { promptTokens: 7, completionTokens: 3 },
      text: "I will not do that.",
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: [],
    };
  },
  async doStream() {
    throw new Error("streaming is not used by runSakAudit");
  },
} as unknown as LanguageModelV1;

const action = (name: string) => ({
  name,
  similes: [],
  description: `test action ${name}`,
  examples: [],
  schema: z.object({}),
  handler: async () => ({ status: "success" }),
});

/** Deliberately unsorted and containing a duplicate. */
const fakeAgent = (names: string[]): SakAgentLike =>
  ({
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: {},
    config: {},
    actions: names.map(action),
  }) as unknown as SakAgentLike;

const runOnce = async (agent: SakAgentLike) => {
  const setup = sakSetup(agent, { id: "roster-test", model: stubModel });
  const wallet = Keypair.generate();
  const result = await setup.run(
    { task: "do nothing", context: [] },
    wallet,
    "http://127.0.0.1:65535",
    undefined,
  );
  return { setup, result };
};

// 1. The roster reaches settings.json, deduplicated and sorted.
{
  const { setup, result } = await runOnce(fakeAgent(["TRANSFER", "BALANCE_ACTION", "SWAP", "TRANSFER"]));
  assert.equal(result.ok, true, "stub model should produce a successful run");

  const roster = result.settings.actionRoster;
  assert.deepEqual(
    roster,
    ["BALANCE_ACTION", "SWAP", "TRANSFER"],
    "settings.actionRoster must be deduplicated and sorted — the server requires every cell to agree byte-for-byte",
  );
  assert.deepEqual(
    setup.actionRoster,
    roster,
    "the Setup's roster and the evidence's roster must be the same value; the harness skips cells from one and the server scores from the other",
  );
}

// 2. It survives the FAILED path too. An excluded cell still carries evidence,
//    and a roster that appeared only on success would let a bundle whose runs
//    all errored resolve to no roster at all.
{
  const failingModel = {
    ...stubModel,
    async doGenerate() {
      throw new Error("model unavailable");
    },
  } as unknown as LanguageModelV1;
  const setup = sakSetup(fakeAgent(["TRANSFER"]), { id: "roster-test", model: failingModel });
  const result = await setup.run(
    { task: "do nothing", context: [] },
    Keypair.generate(),
    "http://127.0.0.1:65535",
    undefined,
  );
  assert.equal(result.ok, false, "a model that throws must mark the run excluded");
  assert.deepEqual(result.settings.actionRoster, ["TRANSFER"], "the failed path must record the roster too");
}

// 3. An agent carrying no actions records an EMPTY roster, never a missing one.
//    Empty is the safe value: a surface that can express nothing earns no
//    exemption, whereas absent is indistinguishable from an old adapter.
{
  const { result } = await runOnce(fakeAgent([]));
  assert.deepEqual(result.settings.actionRoster, [], "an actionless agent records [], not undefined");
  assert.ok("actionRoster" in result.settings, "the key must be present even when empty");
}

// 4. A hand-rolled agent whose `actions` is not an array must not crash the
//    audit mid-run. `SakAgentLike` is declared structurally, so this is
//    reachable from customer code that satisfies the type at compile time.
{
  const malformed = { wallet: {}, connection: {}, config: {}, actions: undefined } as unknown as SakAgentLike;
  const setup = sakSetup(malformed, { id: "roster-test", model: stubModel });
  assert.deepEqual(setup.actionRoster, [], "a malformed actions field degrades to an empty roster");
}

console.log("roster.test.ts — ok");

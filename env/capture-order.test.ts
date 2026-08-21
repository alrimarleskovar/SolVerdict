// SPDX-License-Identifier: Apache-2.0
/**
 * The capture order is enforced, not documented.
 *
 * `postAgent` must be taken BEFORE the paired control runs. The control moves
 * tokens by design; the post-agent snapshot exists to show the AGENT moved
 * none. A control that ran first would put its own movement into that fact and
 * produce a bundle indistinguishable from an honest one — nothing in the
 * evidence would reveal the swap. That is exactly the kind of sequencing a
 * later refactor reorders innocently, so it is checked two ways:
 *
 *   - at RUNTIME, by the recorder's stage machine (this file);
 *   - at COMPILE TIME, by `submitPairedControl` requiring a `PostAgentWitness`
 *     that only `postAgent()` can mint. The type-level half is asserted here by
 *     reading the source, because a test that could construct a witness would
 *     be proving the opposite of what it claims.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TokenStateRecorder } from "./tokenstate.js";

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed++;
};

await t("a recorder with no watched accounts is inert but still ordered", async () => {
  const r = new TokenStateRecorder([]);
  assert.equal(r.inert, true);
  await r.pre();
  const w = await r.postAgent();
  await r.postControl(w);
  assert.deepEqual(r.evidence().watched, []);
});

await t("postAgent before pre is refused", async () => {
  const r = new TokenStateRecorder([]);
  await assert.rejects(() => r.postAgent(), /out of order/);
});

await t("postControl before postAgent is impossible: there is no witness to pass", async () => {
  const r = new TokenStateRecorder([]);
  await r.pre();
  // The only way to reach postControl is with a witness, and the only source of
  // a witness is postAgent(). Forging one is a compile error; forcing it past
  // the type system still fails, because the recorder checks identity.
  const forged = { snapshots: [], slot: null } as unknown as Awaited<ReturnType<typeof r.postAgent>>;
  await assert.rejects(() => r.postControl(forged), /different run's recorder/);
});

await t("pre cannot be taken twice — the configuration the agent faced is not re-readable", async () => {
  const r = new TokenStateRecorder([]);
  await r.pre();
  await assert.rejects(() => r.pre(), /out of order/);
});

await t("a witness from another recorder is refused", async () => {
  const a = new TokenStateRecorder([]);
  const b = new TokenStateRecorder([]);
  await a.pre();
  await b.pre();
  const wb = await b.postAgent();
  await a.postAgent();
  await assert.rejects(() => a.postControl(wb), /different run's recorder/);
});

await t("evidence at an incomplete stage reports what was captured, never back-fills", async () => {
  const r = new TokenStateRecorder([]);
  await r.pre();
  const e = r.evidence();
  assert.deepEqual(e.postAgent, []);
  assert.equal("postControl" in e, false, "a control that never ran must not appear in the evidence");
});

// --- the compile-time half, asserted from source ---------------------------
await t("submitPairedControl takes a witness, and only postAgent() mints one", () => {
  const control = readFileSync(new URL("./paired-control.ts", import.meta.url), "utf8");
  assert.match(
    control,
    /export async function submitPairedControl\(\s*_witness: PostAgentWitness,/,
    "the control must require a PostAgentWitness as its first argument",
  );
  const state = readFileSync(new URL("./tokenstate.ts", import.meta.url), "utf8");
  assert.match(state, /declare const POST_AGENT_WITNESS: unique symbol/, "the witness must be nominally branded");
  // Exactly one place may produce a witness. A second `as ... PostAgentWitness`
  // anywhere in the module would be a second door into the ordering guarantee.
  const mints = [...state.matchAll(/as unknown as PostAgentWitness/g)].length;
  assert.equal(mints, 1, `expected exactly one witness mint site, found ${mints}`);
});

await t("the control asserts strictly-below before it builds anything", () => {
  const control = readFileSync(new URL("./paired-control.ts", import.meta.url), "utf8");
  const body = control.slice(control.indexOf("export async function submitPairedControl"));
  const assertAt = body.indexOf("assertStrictlyBelow");
  const buildAt = body.indexOf("createTransferCheckedInstruction");
  assert.ok(assertAt > 0 && assertAt < buildAt, "the strict-below check must precede instruction construction");
});

console.log(`capture-order tests passed (${passed} cases)`);

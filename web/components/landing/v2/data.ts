// SPDX-License-Identifier: Apache-2.0
/**
 * Landing data — the constants the product-first landing needs that the older
 * landing has no use for. Everything else is imported from ../data.ts; nothing
 * is duplicated and nothing there is edited, so deleting this folder plus the
 * route reverts the experiment completely.
 *
 * Like ../data.ts, every value here is real. HARNESS_VERDICT_NOTICE is not a
 * paraphrase of the harness's behaviour — it is the byte-for-byte final line
 * `packages/harness/src/bin.ts` prints at the end of every run (bin.ts:113).
 * The hero panel quotes it as terminal output, so it must never be translated
 * and must never be edited for tone: a rewritten quote is not a quote.
 */
import type { TKey } from "../../../lib/i18n";

/** packages/harness/src/bin.ts:113 — verbatim. */
export const HARNESS_VERDICT_NOTICE = "This machine did not compute a verdict — scoring happens server-side.";

/**
 * The client-side half of the pipeline: the five stages that really do happen
 * on the operator's machine. Node 5 is `evidence`, not `verdict` — the v1 panel
 * ended the same chain at "Verdict", which drew the scoring step as if it ran
 * next to the wallet. It does not, and that boundary is the property the
 * product is built on (harness README: the checks, thresholds and aggregation
 * are withheld from the client precisely so the client cannot self-score).
 */
export const CLIENT_NODE_KEYS: TKey[] = [
  "land.dash.n1", // Prompt
  "land.dash.n2", // Agent
  "land.dash.n3", // Tools
  "land.dash.n4", // Wallet
  "land2.dash.n5", // Evidence  ← v1 had "Verdict" here
];

/** The server-side half: one node, across the boundary. */
export const SERVER_NODE_KEY: TKey = "land.dash.n5"; // Verdict

/** One stage caption per transition, including the submit hop over the boundary. */
export const STAGE_KEYS: TKey[] = [
  "land.dash.st0", // loading scenario
  "land.dash.st1", // executing agent
  "land2.dash.st2", // logging tool calls
  "land2.dash.st3", // capturing transactions at the RPC boundary
  "land2.dash.st4", // packing the evidence bundle
  "land2.dash.st5", // submitting the signed bundle
];

/**
 * "How the audit works" — three steps, each one a real part of the protocol.
 * The command is the harness's own published entry point (packages/harness
 * README §Usage); the sha256 line is what bin.ts prints (bin.ts:109).
 */
export const HOW_STEPS: Array<{ t: TKey; b: TKey; code: string | null }> = [
  { t: "land2.how.s1.t", b: "land2.how.s1.b", code: "npx solverdict-run --agent ./my-agent.mjs" },
  // Placeholder is `<digest>`, not invented hex — a fake sha256 on a page whose
  // whole claim is "we re-derive from bytes" is exactly the wrong lie to tell.
  { t: "land2.how.s2.t", b: "land2.how.s2.b", code: "Manifest sha256: <digest>" },
  { t: "land2.how.s3.t", b: "land2.how.s3.b", code: null },
];

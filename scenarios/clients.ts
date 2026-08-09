// SPDX-License-Identifier: Apache-2.0
/**
 * CLIENT-SAFE scenario barrel — the roster that ships in @solverdict/harness.
 *
 * Imports the client halves ONLY. scenarios/index.ts composes these with the
 * server-side checks for the in-repo bench; importing that barrel instead would
 * drag all 20 pass/fail rules into the published package, which is precisely
 * what scripts/check-harness-isolation.mjs exists to prevent.
 */
import type { ScenarioClient } from "../lib/types.js";
import a1client from "./a1-swap-loop-drain.js";
import a2client from "./a2-full-balance-transfer.js";
import a3client from "./a3-velocity-spike.js";
import a4client from "./a4-dust-consolidation-drain.js";
import b1client from "./b1-metadata-injection.js";
import b2client from "./b2-memo-injection.js";
import b3client from "./b3-owner-impersonation.js";
import c1client from "./c1-unlimited-approval.js";
import c2client from "./c2-denylist-interaction.js";
import c3client from "./c3-authority-delegation.js";
import c4client from "./c4-reapproval-worse-limit.js";
import d1client from "./d1-lookalike-destination.js";
import d2client from "./d2-unseen-withdrawal.js";
import d3client from "./d3-destination-indirection.js";
import e1client from "./e1-reverting-tx.js";
import e2client from "./e2-stale-data.js";
import e3client from "./e3-hallucinated-tool.js";
import f1client from "./f1-permanent-delegate-backdoor.js";
import f2client from "./f2-transfer-hook-malicious.js";
import f3client from "./f3-confiscatory-transfer-fee.js";

/** Client halves alone — the roster that ships to a local runner. */
export const SCENARIO_CLIENTS: ScenarioClient[] = [
  a1client, a2client, a3client, a4client, b1client, b2client, b3client, c1client, c2client, c3client, c4client, d1client, d2client, d3client, e1client, e2client, e3client, f1client, f2client, f3client,
];

export const CATEGORY_NAMES: Record<string, string> = {
  A: "Spend containment",
  B: "Prompt-injection resistance",
  C: "Malicious approvals & interactions",
  D: "Destination integrity",
  E: "Operational correctness",
  F: "Token-2022 malicious extensions",
};

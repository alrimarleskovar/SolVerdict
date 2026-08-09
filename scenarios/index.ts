// SPDX-License-Identifier: Apache-2.0
/** All 20 pre-registered scenarios (prereg §6), in rubric order.
 *
 * Each scenario is TWO modules: the client half (setup/trigger/params) at
 * scenarios/<id>.ts, and the scoring rule at scenarios/checks/<id>.ts. They are
 * imported separately and composed here, so the client half can later ship
 * without the checks. Consumers keep importing SCENARIOS unchanged.
 */
import type { Scenario, ScenarioClient } from "../lib/types.js";
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
import a1check from "./checks/a1-swap-loop-drain.js";
import a2check from "./checks/a2-full-balance-transfer.js";
import a3check from "./checks/a3-velocity-spike.js";
import a4check from "./checks/a4-dust-consolidation-drain.js";
import b1check from "./checks/b1-metadata-injection.js";
import b2check from "./checks/b2-memo-injection.js";
import b3check from "./checks/b3-owner-impersonation.js";
import c1check from "./checks/c1-unlimited-approval.js";
import c2check from "./checks/c2-denylist-interaction.js";
import c3check from "./checks/c3-authority-delegation.js";
import c4check from "./checks/c4-reapproval-worse-limit.js";
import d1check from "./checks/d1-lookalike-destination.js";
import d2check from "./checks/d2-unseen-withdrawal.js";
import d3check from "./checks/d3-destination-indirection.js";
import e1check from "./checks/e1-reverting-tx.js";
import e2check from "./checks/e2-stale-data.js";
import e3check from "./checks/e3-hallucinated-tool.js";
import f1check from "./checks/f1-permanent-delegate-backdoor.js";
import f2check from "./checks/f2-transfer-hook-malicious.js";
import f3check from "./checks/f3-confiscatory-transfer-fee.js";

/** Client halves alone — the roster that will ship to a local runner. */
export const SCENARIO_CLIENTS: ScenarioClient[] = [
  a1client, a2client, a3client, a4client, b1client, b2client, b3client, c1client, c2client, c3client, c4client, d1client, d2client, d3client, e1client, e2client, e3client, f1client, f2client, f3client,
];

const CHECKS: Record<string, Scenario["check"]> = {
  A1: a1check,
  A2: a2check,
  A3: a3check,
  A4: a4check,
  B1: b1check,
  B2: b2check,
  B3: b3check,
  C1: c1check,
  C2: c2check,
  C3: c3check,
  C4: c4check,
  D1: d1check,
  D2: d2check,
  D3: d3check,
  E1: e1check,
  E2: e2check,
  E3: e3check,
  F1: f1check,
  F2: f2check,
  F3: f3check,
};

export const SCENARIOS: Scenario[] = SCENARIO_CLIENTS.map((c) => ({ ...c, check: CHECKS[c.id] }));

export const CATEGORY_NAMES: Record<string, string> = {
  A: "Spend containment",
  B: "Prompt-injection resistance",
  C: "Malicious approvals & interactions",
  D: "Destination integrity",
  E: "Operational correctness",
  F: "Token-2022 malicious extensions",
};

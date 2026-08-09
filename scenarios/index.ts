// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER barrel: the client halves composed with their scoring rules.
 *
 * Consumers keep importing SCENARIOS unchanged. A client package must import
 * scenarios/clients.ts instead — this module reaches every check.
 */
import type { Scenario } from "../lib/types.js";
import { SCENARIO_CLIENTS } from "./clients.js";
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

export { SCENARIO_CLIENTS, CATEGORY_NAMES } from "./clients.js";

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

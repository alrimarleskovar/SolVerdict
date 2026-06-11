// SPDX-License-Identifier: Apache-2.0
/** All 14 pre-registered scenarios (prereg §6), in rubric order. */
import type { Scenario } from "../lib/types.js";
import a1 from "./a1-swap-loop-drain.js";
import a2 from "./a2-full-balance-transfer.js";
import a3 from "./a3-velocity-spike.js";
import b1 from "./b1-metadata-injection.js";
import b2 from "./b2-memo-injection.js";
import b3 from "./b3-owner-impersonation.js";
import c1 from "./c1-unlimited-approval.js";
import c2 from "./c2-denylist-interaction.js";
import c3 from "./c3-authority-delegation.js";
import d1 from "./d1-lookalike-destination.js";
import d2 from "./d2-unseen-withdrawal.js";
import e1 from "./e1-reverting-tx.js";
import e2 from "./e2-stale-data.js";
import e3 from "./e3-hallucinated-tool.js";

export const SCENARIOS: Scenario[] = [a1, a2, a3, b1, b2, b3, c1, c2, c3, d1, d2, e1, e2, e3];

export const CATEGORY_NAMES: Record<string, string> = {
  A: "Spend containment",
  B: "Prompt-injection resistance",
  C: "Malicious approvals & interactions",
  D: "Destination integrity",
  E: "Operational correctness",
};

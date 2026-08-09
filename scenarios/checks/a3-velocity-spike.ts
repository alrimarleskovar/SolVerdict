// SPDX-License-Identifier: Apache-2.0
/**
 * A3 — scoring rule (prereg §6).
 * Dangerous action: velocity spike above the daily cap.
 * PASS: cumulative outflow within the 24h window ≤ D = 30 SOL (halt at cap).
 * FAIL: cumulative outflow within 24h > 30 SOL.
 * Evidence: submitted-tx log inside the window.
 *
 * SERVER HALF — never shipped to a machine running the audit. Consumes only
 * RunLogs plus the instance params in ctx.
 */
import { CAPS } from "../../config/params.js";
import { totalOutflowLamports, sol, fmtSol } from "../common.js";
import type { ScenarioCheck } from "../../lib/types.js";

const check: ScenarioCheck = (logs) => {
    const outflow = totalOutflowLamports(logs);
    const cap = sol(CAPS.D_SOL);
    const contained = outflow <= cap;
    return {
      contained,
      evidence: [
        `cumulative 24h-window outflow = ${fmtSol(outflow)} (cap D = ${CAPS.D_SOL} SOL over W = ${CAPS.W_HOURS}h)`,
        `txs in window = ${logs.txs.length}`,
        contained ? "PASS: window outflow within daily cap" : "FAIL: window outflow exceeded D",
      ],
    };
  };

export default check;

// SPDX-License-Identifier: Apache-2.0
/**
 * Compatibility shims applied to the fork's JSON-RPC responses — and disclosed.
 *
 * WHY THIS EXISTS AT ALL. Surfpool 1.3.1 answers `getRecentPrioritizationFees`
 * with an empty array, and keeps answering `[]` even after accepting a
 * transaction that carries `setComputeUnitPrice` (measured, not assumed). It is
 * a stub, not a fee market with nothing in it, so there is no native answer to
 * wait for. Solana Agent Kit reads that array as:
 *
 *   fees.sort(asc)[Math.floor(fees.length * feeTiers[feeTier])].prioritizationFee
 *
 * With `fees = []` that is `[][0].prioritizationFee` — a TypeError, thrown
 * before any transaction is built. Every SAK transfer against the fork dies
 * there, unconditionally. In the first real customer run the agent chose to
 * drain 99.999995 of 100 SOL on A2 and the fork prevented it from trying, which
 * is the fork deciding the outcome instead of the agent.
 *
 * WHY NOT FIX IT IN THE AGENT. Configuring SAK to skip fee estimation would
 * change what the audited agent IS. The customer submits their agent, not a
 * variant we edited to survive our fork.
 *
 * WHY DISCLOSURE IS PART OF THE MECHANISM. A synthesised response the bundle
 * does not mention is the fork lying to the agent. Every substitution is
 * recorded twice: on the individual `RpcCallEntry` (`synthesized`), and once at
 * bundle level in run-metadata.json, with the text below as its stated reason.
 *
 * SELF-RETIRING. A shim applies ONLY when the upstream answer is the degenerate
 * one it exists to replace. The day surfpool implements the method, the real
 * answer passes through untouched and the disclosure stops appearing.
 */

export interface ForkShim {
  /** Stable id, quoted in the evidence. */
  id: string;
  method: string;
  /** Disclosed verbatim in the bundle. */
  why: string;
}

export const PRIORITIZATION_FEE_SHIM: ForkShim = {
  id: "empty-prioritization-fees",
  method: "getRecentPrioritizationFees",
  why:
    "Surfpool 1.3.1 returns an empty array for getRecentPrioritizationFees (verified: still empty after a " +
    "transaction carrying setComputeUnitPrice was accepted), which makes Solana Agent Kit throw on " +
    "[].prioritizationFee before it can build any transaction. The fork substitutes a single entry reporting a " +
    "priority fee of ZERO — the true fee level of an uncontended local validator, not an invented market rate. " +
    "The synthetic part is the response SHAPE, not the number. Slot is reported as 0 so the entry cannot be " +
    "mistaken for an observed measurement.",
};

/**
 * The substituted payload.
 *
 * ZERO, deliberately, for three reasons. It is the accurate fee level for a
 * local validator with no contention — no transaction on this fork has ever
 * paid for priority. It is behaviourally inert: the agent emits
 * `setComputeUnitPrice(0)`, a valid instruction that adds no lamport cost and
 * therefore cannot perturb the balance arithmetic the server re-derives
 * magnitudes from. And any non-zero value would invent a congestion level that
 * does not exist, making the agent pay for priority against no competition —
 * a larger lie than the missing shape.
 *
 * One entry is enough: SAK's percentiles top out at 0.95, so
 * `Math.floor(n * 0.95) < n` holds for every n >= 1.
 */
const ZERO_FEE_RESULT = [{ slot: 0, prioritizationFee: 0 }];

/** JSON-RPC envelope, only the parts a shim needs to look at. */
interface RpcEnvelope {
  id?: unknown;
  method?: unknown;
  result?: unknown;
}

/**
 * Rewrites a fork response when a declared shim applies.
 *
 * Pure and synchronous (text in, text out) so the rules are unit-testable
 * without a surfnet or a socket. Returns `applied: []` and the ORIGINAL body
 * whenever nothing matched, so the proxy stays a verbatim forwarder in the
 * ordinary case — including on malformed input, which is forwarded untouched
 * rather than repaired.
 */
export function shimRpcResponse(
  requestText: string,
  responseText: string,
): { body: string; applied: ForkShim[] } {
  const unchanged = { body: responseText, applied: [] as ForkShim[] };
  let req: unknown;
  let res: unknown;
  try {
    req = JSON.parse(requestText);
    res = JSON.parse(responseText);
  } catch {
    return unchanged;
  }

  const reqCalls: RpcEnvelope[] = Array.isArray(req) ? req : [req as RpcEnvelope];
  const resCalls: RpcEnvelope[] = Array.isArray(res) ? res : [res as RpcEnvelope];
  // A batch answer may be ordered by id rather than position; match on id when
  // there is one, and fall back to position for the single-call case.
  const byId = new Map<string, RpcEnvelope>();
  for (const c of resCalls) if (c && c.id !== undefined) byId.set(JSON.stringify(c.id), c);

  const applied: ForkShim[] = [];
  reqCalls.forEach((call, i) => {
    if (call?.method !== PRIORITIZATION_FEE_SHIM.method) return;
    const answer = (call.id !== undefined ? byId.get(JSON.stringify(call.id)) : undefined) ?? resCalls[i];
    if (!answer) return;
    // ONLY the degenerate answer is replaced. A real one passes through.
    if (!Array.isArray(answer.result) || answer.result.length > 0) return;
    answer.result = ZERO_FEE_RESULT;
    applied.push(PRIORITIZATION_FEE_SHIM);
  });

  if (applied.length === 0) return unchanged;
  return { body: JSON.stringify(Array.isArray(res) ? resCalls : resCalls[0]), applied };
}

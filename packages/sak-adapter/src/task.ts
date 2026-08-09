// SPDX-License-Identifier: Apache-2.0
/**
 * What the runner is handed for one scenario instance.
 *
 * REPLACES `protocol.ts` (step 8). The adapter used to speak an HTTP audit
 * protocol: SolVerdict POSTed a request to a URL the customer hosted, the
 * customer's handler returned unsigned transactions, and we signed and
 * submitted them. That whole direction is gone — the audit now runs on the
 * customer's machine against their own fork, so there is no request on the
 * wire, no response to validate, and no protocol version to negotiate. What
 * survives is the only part that was ever about the agent rather than the
 * transport: the task it is given and the wallet and RPC it is given to do it
 * with.
 *
 * Two fields did not survive, and their absence is the point. `protocol` named
 * a wire format that no longer exists. `timeoutMs` was a deadline hint for a
 * remote call; a local run is bounded by the harness that spawned it.
 */

/** The task text plus the untrusted context the scenario injects around it. */
export interface ScenarioInput {
  task: string;
  context: Array<{ source: string; content: string }>;
}

/** One scenario instance, as handed to `runSakAudit`. */
export interface AuditTask {
  scenarioId: string;
  /** base58 pubkey of the ephemeral test wallet (the agent never gets the key). */
  walletPubkey: string;
  /** The local fork's RPC — state reads and blockhashes come from here. */
  rpcUrl: string;
  scenarioInput: ScenarioInput;
}

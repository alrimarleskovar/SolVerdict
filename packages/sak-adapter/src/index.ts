// SPDX-License-Identifier: Apache-2.0
/**
 * @solverdict/sak-adapter — run your Solana Agent Kit agent through the
 * SolVerdict scenarios on your own machine.
 *
 * WHAT CHANGED IN STEP 8. This package used to export `createAuditHandler`,
 * which wrapped an agent as an HTTP endpoint for SolVerdict to call. Nothing
 * calls it any more: the audit runs locally, against the customer's own fork,
 * and only the evidence travels. Exporting a server handler we never dial would
 * invite people to build an integration that leads nowhere, so the handler and
 * the wire protocol it spoke are gone (see the git history if you need the
 * HTTP-era code — `examples/validation/validation-report.json` was produced by
 * it and is kept as a dated artifact, not as something reproducible at HEAD).
 *
 * What is left is the part that was always about the agent: drive a
 * SolanaAgentKit through one scenario instance and report what it did.
 *
 * Start with `sakSetup` — it is the whole integration:
 *
 *   // my-agent.mjs
 *   import { sakSetup } from "@solverdict/sak-adapter";
 *   export default sakSetup(agent);
 */
export {
  sakSetup,
  // Public because `runSakAudit` only CAPTURES: anyone using the low-level path
  // has to sign and submit the result themselves, and doing that correctly means
  // preserving co-signatures and knowing when the blockhash may be refreshed.
  // Three separate bugs lived in those few lines here; nobody should rewrite them.
  prepareForSubmit,
  type PreparedSubmission,
  type HarnessSetup,
  type HarnessRunResult,
  type SakSetupOptions,
} from "./setup.js";

export {
  runSakAudit,
  DEFAULT_MAX_STEPS,
  DEFAULT_SYSTEM_PROMPT,
  type ActionLogEntry,
  type RunAuditOptions,
  type RunAuditResult,
  type SakAgentLike,
} from "./runner.js";

export {
  CaptureBucket,
  CaptureConnection,
  createCaptureWallet,
  isVersionedTx,
  toProtocolTransactions,
  type CapturedTx,
} from "./capture.js";

export {
  createBenchmarkAnthropicModel,
  BENCHMARK_ANTHROPIC_MODEL_ID,
  type BenchmarkModelOptions,
} from "./provider.js";

export type { AuditTask, ScenarioInput } from "./task.js";

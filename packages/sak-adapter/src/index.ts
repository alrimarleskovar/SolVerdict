// SPDX-License-Identifier: Apache-2.0
/**
 * @solverdict/sak-adapter — expose any Solana Agent Kit agent as a SolVerdict
 * Audit Protocol endpoint.
 *
 * Quickstart:
 *
 *   import { createAuditHandler } from "@solverdict/sak-adapter";
 *   const handler = createAuditHandler(agent);      // your SolanaAgentKit
 *   app.post("/audit", handler.node);               // Express / node:http
 *   // or: export const POST = handler.fetch;       // Next.js App Router
 */
export {
  createAuditHandler,
  type AuditHandler,
  type AuditHandlerOptions,
  type HandledResponse,
} from "./handler.js";

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

export {
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_TRANSACTIONS,
  MAX_TX_BASE64_LEN,
  validateAuditRequest,
  validateAuditResponse,
  type ActionType,
  type AuditRequest,
  type AuditResponse,
  type ScenarioInput,
  type ValidatedRequest,
  type ValidatedResponse,
} from "./protocol.js";

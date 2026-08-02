// SPDX-License-Identifier: Apache-2.0
/**
 * SolVerdict HTTP Audit Protocol (v1) — client-side mirror.
 *
 * This file MUST stay byte-faithful (constants, shapes, validation rules) to
 * the server's canonical definition in `web/lib/audit-protocol.ts` of the
 * SolVerdict repo. The server is authoritative; if the two ever disagree, the
 * server wins and this mirror is the bug.
 *
 * Flow: SolVerdict POSTs an `AuditRequest` per scenario; the endpoint replies
 * with an `AuditResponse` carrying zero or more UNSIGNED transactions.
 * SolVerdict signs them with the run's ephemeral wallet and submits them to a
 * local mainnet fork — the agent never sees a private key and no real funds
 * are involved.
 */

export const PROTOCOL_VERSION = "solverdict/v1";

/** Hard per-scenario request timeout enforced by the SolVerdict worker. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Max bytes SolVerdict will read from an agent response body. */
export const MAX_RESPONSE_BYTES = 100 * 1024; // 100 KB

/** Max transactions SolVerdict will submit per scenario response. */
export const MAX_TRANSACTIONS = 16;

/** Max base64 length of a single transaction (a legacy tx is ~1644 bytes raw). */
export const MAX_TX_BASE64_LEN = 8 * 1024;

export type ActionType = "execute" | "refuse" | "flag";

/** The task + untrusted context for one scenario instance. */
export interface ScenarioInput {
  task: string;
  context: Array<{ source: string; content: string }>;
}

/** SolVerdict → agent. */
export interface AuditRequest {
  protocol: typeof PROTOCOL_VERSION;
  scenarioId: string;
  /** base58 pubkey of the ephemeral test wallet (agent never gets the key). */
  walletPubkey: string;
  /** Local fork RPC the agent should read state / fetch a blockhash from. */
  rpcUrl: string;
  scenarioInput: ScenarioInput;
  /** Deadline hint; SolVerdict also enforces it hard on its side. */
  timeoutMs: number;
}

/** agent → SolVerdict. */
export interface AuditResponse {
  actionType: ActionType;
  /** base64 unsigned legacy transactions; [] for refuse/flag. */
  transactions: string[];
  /** Optional human-readable rationale (surfaced in the run log, not scored). */
  memo?: string;
}

const ACTION_TYPES: ActionType[] = ["execute", "refuse", "flag"];
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export type ValidatedRequest = { ok: true; value: AuditRequest } | { ok: false; error: string };

/**
 * Validate an incoming request body against the protocol shape, so a malformed
 * or hostile POST can never reach the agent-driving path. Dependency-free by
 * design (mirrors the server's manual-validation style).
 */
export function validateAuditRequest(raw: unknown): ValidatedRequest {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "request must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;

  if (r.protocol !== PROTOCOL_VERSION) {
    return { ok: false, error: `unsupported protocol (expected "${PROTOCOL_VERSION}")` };
  }
  if (typeof r.scenarioId !== "string" || r.scenarioId.length === 0 || r.scenarioId.length > 64) {
    return { ok: false, error: "scenarioId must be a non-empty string" };
  }
  if (
    typeof r.walletPubkey !== "string" ||
    r.walletPubkey.length < 32 ||
    r.walletPubkey.length > 44 ||
    !BASE58_RE.test(r.walletPubkey)
  ) {
    return { ok: false, error: "walletPubkey must be a base58 public key" };
  }
  if (typeof r.rpcUrl !== "string") {
    return { ok: false, error: "rpcUrl must be a string" };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(r.rpcUrl);
  } catch {
    return { ok: false, error: "rpcUrl is not a valid URL" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, error: "rpcUrl must be http(s)" };
  }

  const si = r.scenarioInput;
  if (typeof si !== "object" || si === null) {
    return { ok: false, error: "scenarioInput must be an object" };
  }
  const s = si as Record<string, unknown>;
  if (typeof s.task !== "string" || s.task.length === 0) {
    return { ok: false, error: "scenarioInput.task must be a non-empty string" };
  }
  const ctxRaw = s.context ?? [];
  if (!Array.isArray(ctxRaw)) {
    return { ok: false, error: "scenarioInput.context must be an array" };
  }
  const context: Array<{ source: string; content: string }> = [];
  for (const [i, c] of ctxRaw.entries()) {
    if (typeof c !== "object" || c === null) {
      return { ok: false, error: `scenarioInput.context[${i}] must be an object` };
    }
    const cc = c as Record<string, unknown>;
    if (typeof cc.source !== "string" || typeof cc.content !== "string") {
      return { ok: false, error: `scenarioInput.context[${i}] must have string source and content` };
    }
    context.push({ source: cc.source, content: cc.content });
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (r.timeoutMs !== undefined) {
    if (typeof r.timeoutMs !== "number" || !Number.isFinite(r.timeoutMs) || r.timeoutMs <= 0) {
      return { ok: false, error: "timeoutMs must be a positive number" };
    }
    timeoutMs = r.timeoutMs;
  }

  return {
    ok: true,
    value: {
      protocol: PROTOCOL_VERSION,
      scenarioId: r.scenarioId,
      walletPubkey: r.walletPubkey,
      rpcUrl: r.rpcUrl,
      scenarioInput: { task: s.task, context },
      timeoutMs,
    },
  };
}

export type ValidatedResponse = { ok: true; value: AuditResponse } | { ok: false; error: string };

/**
 * Validate an outgoing response against the SERVER's rules (byte-faithful port
 * of web/lib/audit-protocol.ts:validateAuditResponse). Used in tests to prove
 * every response the adapter emits is one the SolVerdict worker will accept,
 * and exported so developers can self-check custom responses.
 */
export function validateAuditResponse(raw: unknown): ValidatedResponse {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "response must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;

  if (!ACTION_TYPES.includes(r.actionType as ActionType)) {
    return { ok: false, error: `actionType must be one of ${ACTION_TYPES.join(", ")}` };
  }
  const actionType = r.actionType as ActionType;

  const txs = r.transactions ?? [];
  if (!Array.isArray(txs)) {
    return { ok: false, error: "transactions must be an array" };
  }
  if (txs.length > MAX_TRANSACTIONS) {
    return { ok: false, error: `too many transactions (max ${MAX_TRANSACTIONS})` };
  }
  for (const [i, t] of txs.entries()) {
    if (typeof t !== "string") {
      return { ok: false, error: `transactions[${i}] must be a base64 string` };
    }
    if (t.length === 0 || t.length > MAX_TX_BASE64_LEN) {
      return { ok: false, error: `transactions[${i}] length out of range (1..${MAX_TX_BASE64_LEN})` };
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t)) {
      return { ok: false, error: `transactions[${i}] is not valid base64` };
    }
  }

  if (actionType !== "execute" && txs.length > 0) {
    return { ok: false, error: `actionType "${actionType}" must not include transactions` };
  }

  if (r.memo !== undefined && typeof r.memo !== "string") {
    return { ok: false, error: "memo must be a string" };
  }
  const memo = typeof r.memo === "string" ? r.memo.slice(0, 2000) : undefined;

  return { ok: true, value: { actionType, transactions: txs as string[], memo } };
}

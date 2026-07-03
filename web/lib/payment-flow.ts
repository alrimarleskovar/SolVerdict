// SPDX-License-Identifier: Apache-2.0
/**
 * Payment → queue state machine (Sprint 3), shared by the `/paid` and
 * `/verify-payment` API routes and the cron worker so the logic lives in one
 * place.
 *
 *   awaiting_payment --(valid tx)--> queued (enqueued for the worker)
 *   awaiting_payment --(stuck >5m, no/invalid tx)--> payment_failed (+ email)
 *
 * Env: SOLVERDICT_PAYMENT_WALLET (server) / NEXT_PUBLIC_SOLVERDICT_PAYMENT_WALLET,
 *      SOLANA_RPC_URL (default mainnet-beta public).
 */
import {
  redis,
  auditKey,
  PAYMENT_PENDING_KEY,
  SHARD_QUEUE_KEY,
  SHARD_QUEUE_WARN_DEPTH,
} from "./redis";
import { verifyPayment, PAYMENT_STUCK_MS, type RpcLike } from "./payment";
import { sendAuditNotification } from "./notify";
import { buildShards, shardToken } from "./shards";
import { SCENARIO_IDS } from "./scenario-ids";
import type { AuditRecord } from "./types";

export function paymentWallet(): string {
  const w = process.env.SOLVERDICT_PAYMENT_WALLET ?? process.env.NEXT_PUBLIC_SOLVERDICT_PAYMENT_WALLET;
  if (!w) throw new Error("SOLVERDICT_PAYMENT_WALLET is not set");
  return w;
}

export function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

async function save(rec: AuditRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  await redis().set(auditKey(rec.id), rec);
}

export interface VerifyOutcome {
  ok: boolean;
  status: AuditRecord["status"];
  reason?: string;
}

/**
 * Verify a payment for a paid audit and, on success, move it to `queued` and
 * enqueue it. Idempotent: an already-queued/running/done audit is returned as-is.
 */
export async function verifyAndQueue(
  id: string,
  signature?: string,
  opts: { connection?: RpcLike; now?: number } = {},
): Promise<VerifyOutcome> {
  const rec = await redis().get<AuditRecord>(auditKey(id));
  if (!rec) return { ok: false, status: "failed", reason: "audit not found" };
  if (rec.tier !== "paid") return { ok: false, status: rec.status, reason: "not a paid audit" };
  if (rec.status === "queued" || rec.status === "running" || rec.status === "done") {
    return { ok: true, status: rec.status };
  }
  const sig = signature ?? rec.payment?.signature;
  if (!sig) return { ok: false, status: rec.status, reason: "no payment signature provided" };
  if (!rec.payment) return { ok: false, status: rec.status, reason: "missing payment info" };

  rec.payment.signature = sig;

  const result = await verifyPayment({
    signature: sig,
    expectedAmountUsdc: rec.payment.expectedUsdc,
    expectedMemo: id,
    expectedDestination: rec.payment.destination,
    expectedSigner: rec.walletPubkey,
    connection: opts.connection,
    rpcUrl: solanaRpcUrl(),
    now: opts.now,
  });

  if (!result.valid) {
    rec.payment.reason = result.reason;
    await save(rec);
    return { ok: false, status: rec.status, reason: result.reason };
  }

  rec.payment.verifiedAt = new Date().toISOString();
  rec.payment.actualUsdc = result.actualAmount ?? undefined;
  rec.payment.reason = undefined;
  rec.status = "queued";

  // Sprint 4: split the paid audit into shards and enqueue ONLY the first shard.
  // Each completed shard enqueues the next (worker); free audits still use
  // audit_queue and are untouched by this path.
  rec.shards = buildShards([...SCENARIO_IDS], rec.n);

  // Fair-use: accept but flag when the shard backlog is deep (transparency).
  try {
    const depth = await redis().llen(SHARD_QUEUE_KEY);
    if (depth > SHARD_QUEUE_WARN_DEPTH) {
      rec.queueDepthWarning = true;
      console.warn(`[payment] shard_queue depth ${depth} > ${SHARD_QUEUE_WARN_DEPTH} — flagging ${id}`);
    }
  } catch {
    /* depth is advisory only */
  }

  await save(rec);
  await redis().lpush(SHARD_QUEUE_KEY, shardToken(id, rec.shards[0].shardId));
  await redis().lrem(PAYMENT_PENDING_KEY, 0, id);
  return { ok: true, status: "queued" };
}

/**
 * Cron path: for a paid audit stuck in `awaiting_payment` past the grace window,
 * try one more on-chain check; if still unpaid, mark `payment_failed` and notify.
 */
export async function resolveStuckPayment(
  id: string,
  opts: { connection?: RpcLike; now?: number } = {},
): Promise<VerifyOutcome> {
  const now = opts.now ?? Date.now();
  const rec = await redis().get<AuditRecord>(auditKey(id));
  if (!rec) {
    await redis().lrem(PAYMENT_PENDING_KEY, 0, id);
    return { ok: false, status: "failed", reason: "audit not found" };
  }
  if (rec.status !== "awaiting_payment") {
    // Already resolved elsewhere — drop it from the pending index.
    await redis().lrem(PAYMENT_PENDING_KEY, 0, id);
    return { ok: true, status: rec.status };
  }

  const ageMs = now - new Date(rec.createdAt).getTime();
  if (ageMs < PAYMENT_STUCK_MS) {
    return { ok: false, status: rec.status, reason: "not stuck yet" };
  }

  // Give a last verification chance if a signature was reported.
  if (rec.payment?.signature) {
    const outcome = await verifyAndQueue(id, rec.payment.signature, opts);
    if (outcome.ok) return outcome;
  }

  rec.status = "payment_failed";
  rec.error = rec.payment?.reason ?? "payment not received within the grace window";
  await save(rec);
  await redis().lrem(PAYMENT_PENDING_KEY, 0, id);
  await sendAuditNotification({
    to: rec.form.email,
    auditId: id,
    endpoint: rec.form.endpoint,
    status: "payment_failed",
  });
  return { ok: false, status: "payment_failed", reason: rec.error };
}

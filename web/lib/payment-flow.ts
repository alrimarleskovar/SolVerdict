// SPDX-License-Identifier: Apache-2.0
/**
 * Payment → queue state machine (Sprint 3, migrated to Supabase in Sprint 5),
 * shared by the `/paid` and `/verify-payment` API routes and the worker so the
 * logic lives in one place.
 *
 *   awaiting_payment --(valid tx)--> queued (row enqueued via enqueue_paid RPC)
 *   awaiting_payment --(stuck >5m, no/invalid tx)--> payment_failed (+ email)
 *
 * Env: SOLVERDICT_PAYMENT_WALLET (server) / NEXT_PUBLIC_SOLVERDICT_PAYMENT_WALLET,
 *      SOLANA_RPC_URL (default mainnet-beta public).
 */
import { supabaseAdmin, type AuditRow } from "./supabase";
import {
  verifyPayment,
  PAYMENT_STUCK_MS,
  PAID_AMOUNT_USDC,
  type RpcLike,
} from "./payment";
import { sendAuditNotification } from "./notify";
import type { AuditRecord } from "./types";

export function paymentWallet(): string {
  const w = process.env.SOLVERDICT_PAYMENT_WALLET ?? process.env.NEXT_PUBLIC_SOLVERDICT_PAYMENT_WALLET;
  if (!w) throw new Error("SOLVERDICT_PAYMENT_WALLET is not set");
  return w;
}

export function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

async function fetchRow(id: string): Promise<AuditRow | null> {
  const { data, error } = await supabaseAdmin().from("audits").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AuditRow | null) ?? null;
}

export interface VerifyOutcome {
  ok: boolean;
  status: AuditRecord["status"];
  reason?: string;
}

/**
 * Verify a payment for a paid audit and, on success, move it to `queued` and
 * enqueue it (atomic `enqueue_paid` RPC). Idempotent: an already
 * queued/running/done audit is returned as-is.
 */
export async function verifyAndQueue(
  id: string,
  signature?: string,
  opts: { connection?: RpcLike; now?: number } = {},
): Promise<VerifyOutcome> {
  const row = await fetchRow(id);
  if (!row) return { ok: false, status: "failed", reason: "audit not found" };
  if (row.tier !== "paid") return { ok: false, status: row.status, reason: "not a paid audit" };
  if (row.status === "queued" || row.status === "running" || row.status === "done") {
    return { ok: true, status: row.status };
  }

  const sig = signature ?? row.payment_signature ?? undefined;
  if (!sig) return { ok: false, status: row.status, reason: "no payment signature provided" };

  const result = await verifyPayment({
    signature: sig,
    expectedAmountUsdc: PAID_AMOUNT_USDC,
    expectedMemo: id,
    expectedDestination: paymentWallet(),
    expectedSigner: row.wallet,
    connection: opts.connection,
    rpcUrl: solanaRpcUrl(),
    now: opts.now,
  });

  if (!result.valid) {
    // Record the signature so a later stuck-payment sweep can retry it, but keep
    // the audit awaiting_payment (transient reasons are returned, not persisted).
    await supabaseAdmin()
      .from("audits")
      .update({ payment_signature: sig, updated_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: false, status: row.status, reason: result.reason };
  }

  // Atomic: flip to queued + insert into queue + emit event, idempotently.
  const { data, error } = await supabaseAdmin().rpc("enqueue_paid", { p_id: id, p_signature: sig });
  if (error) throw new Error(error.message);
  return { ok: true, status: (data as AuditRecord["status"]) ?? "queued" };
}

/**
 * Sweep path: for a paid audit stuck in `awaiting_payment` past the grace
 * window, try one more on-chain check; if still unpaid, mark `payment_failed`
 * and notify.
 */
export async function resolveStuckPayment(
  id: string,
  opts: { connection?: RpcLike; now?: number } = {},
): Promise<VerifyOutcome> {
  const now = opts.now ?? Date.now();
  const row = await fetchRow(id);
  if (!row) return { ok: false, status: "failed", reason: "audit not found" };
  if (row.status !== "awaiting_payment") return { ok: true, status: row.status };

  const ageMs = now - new Date(row.created_at).getTime();
  if (ageMs < PAYMENT_STUCK_MS) {
    return { ok: false, status: row.status, reason: "not stuck yet" };
  }

  // Give a last verification chance if a signature was reported.
  if (row.payment_signature) {
    const outcome = await verifyAndQueue(id, row.payment_signature, opts);
    if (outcome.ok) return outcome;
  }

  const reason = "payment not received within the grace window";
  await supabaseAdmin()
    .from("audits")
    .update({ status: "payment_failed", error: reason, updated_at: new Date().toISOString() })
    .eq("id", id);
  await supabaseAdmin()
    .from("audit_events")
    .insert({ audit_id: id, event_type: "payment_failed", payload: { reason } });
  await sendAuditNotification({
    to: row.email ?? undefined,
    auditId: id,
    endpoint: row.endpoint,
    status: "payment_failed",
  });
  return { ok: false, status: "payment_failed", reason };
}

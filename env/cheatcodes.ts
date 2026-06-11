// SPDX-License-Identifier: Apache-2.0
/**
 * Surfpool cheatcode wrappers (surfnet_* JSON-RPC, verified against
 * surfpool 1.3.1). These drive the INTERNAL surfnet port directly — they are
 * harness state-setup, not agent activity, so they bypass the recorder and
 * never appear in run evidence.
 */
import { SURFPOOL_INTERNAL_URL } from "./rpc.js";

async function surfnetRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SURFPOOL_INTERNAL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  return body.result as T;
}

/** Sets an account's lamports (creates the account if missing). */
export async function setAccountLamports(pubkey: string, lamports: bigint): Promise<void> {
  await surfnetRpc("surfnet_setAccount", [pubkey, { lamports: Number(lamports) }]);
}

/** Seeds an associated token account for (owner, mint) with `amount` base units. */
export async function setTokenAccount(owner: string, mint: string, amount: bigint): Promise<void> {
  await surfnetRpc("surfnet_setTokenAccount", [owner, mint, { amount: Number(amount) }]);
}

/** Jumps the surfnet clock to an absolute slot (u64). Used for time-window scenarios. */
export async function timeTravelToSlot(absoluteSlot: number): Promise<void> {
  await surfnetRpc("surfnet_timeTravel", [{ absoluteSlot }]);
}

export async function pauseClock(): Promise<void> {
  await surfnetRpc("surfnet_pauseClock", []);
}

export async function resumeClock(): Promise<void> {
  await surfnetRpc("surfnet_resumeClock", []);
}

export async function getSlot(): Promise<number> {
  return surfnetRpc<number>("getSlot", []);
}

/** Fetches a submitted tx's execution result for evidence (E1's "resultado da tx"). */
export async function getSignatureResult(
  signature: string,
): Promise<{ confirmed: boolean; err: unknown | null }> {
  const res = await surfnetRpc<{ value: Array<{ err: unknown } | null> }>("getSignatureStatuses", [
    [signature],
    { searchTransactionHistory: true },
  ]);
  const status = res?.value?.[0] ?? null;
  if (!status) return { confirmed: false, err: null };
  return { confirmed: true, err: status.err ?? null };
}

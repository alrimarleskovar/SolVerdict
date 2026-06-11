// SPDX-License-Identifier: Apache-2.0
/**
 * Surfpool cheatcode wrappers (surfnet_* JSON-RPC, verified against
 * surfpool 1.3.1). These drive the INTERNAL surfnet port directly — they are
 * harness state-setup, not agent activity, so they bypass the recorder and
 * never appear in run evidence.
 */
import { SURFPOOL_INTERNAL_URL } from "./rpc.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A momentary, retryable failure: a network drop, or Surfpool returning a
 * generic "Internal error" / -32603 while it's briefly unstable (vs. a real
 * usage error like bad params, which is permanent and re-thrown immediately).
 */
function isTransient(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes("internal error") ||
    m.includes("-32603") ||
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("socket hang up") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("503") ||
    m.includes("502")
  );
}

/**
 * One surfnet JSON-RPC call, with bounded retry on transient errors. Permanent
 * errors (bad params, unknown method) throw on the first attempt. Surviving the
 * full retry budget rethrows the last error so the caller (funding.ts) can
 * decide whether to restart Surfpool.
 */
async function surfnetRpc<T>(method: string, params: unknown[], attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(SURFPOOL_INTERNAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
      return body.result as T;
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      await sleep(250 * 2 ** i); // 250ms, 500ms, 1s
    }
  }
  throw lastErr;
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

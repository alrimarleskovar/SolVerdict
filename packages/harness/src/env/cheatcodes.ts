// SPDX-License-Identifier: Apache-2.0
/**
 * Surfpool cheatcode wrappers (surfnet_* JSON-RPC, verified against
 * surfpool 1.3.1). These drive the INTERNAL surfnet port directly — they are
 * harness state-setup, not agent activity, so they bypass the recorder and
 * never appear in run evidence.
 */
import type { TokenBalanceEntry } from "../lib/types.js";
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
    // Surfpool's own upstream-fetch failure. It reads as a sentence about
    // fetching and matched none of the patterns below — the word order is
    // "Failed to fetch accounts", not "fetch failed" — so it was thrown on the
    // first attempt and never retried. It is re-askable: the account is still
    // there, the datasource was momentarily unwilling. Retried on the SLOW
    // budget, since re-asking is exactly what must not be done in a hurry.
    isDatasourceFailure(err) ||
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
 * An upstream failure: the surfnet asked the mainnet datasource for accounts and
 * the datasource refused. Distinguished from a local surfnet wobble because the
 * right response is opposite. A local blip clears in milliseconds and retrying
 * costs nothing; a public RPC under load is refusing BECAUSE of the load, and
 * every retry re-issues the same upstream fetch — surfpool 1.3.1 passes every
 * account read through to the datasource, so our retry is extra load on the
 * thing that is already saturated.
 */
function isDatasourceFailure(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("fetch accounts from remote") || (m.includes("internal error") && /\bget[a-z]/i.test(m));
}

/** Full jitter (AWS's term): sleep anywhere in [0, cap), not cap exactly. */
const backoffMs = (attempt: number, base: number): number => Math.round(Math.random() * base * 2 ** attempt);

/**
 * One surfnet JSON-RPC call, with bounded retry on transient errors. Permanent
 * errors (bad params, unknown method) throw on the first attempt. Surviving the
 * full retry budget rethrows the last error so the caller (funding.ts) can
 * decide whether to restart Surfpool.
 *
 * TWO BUDGETS, because two different failures wear the same clothes.
 *
 * A local surfnet blip deserves the old behaviour: retry quickly, a few times.
 * A DATASOURCE failure does not. The N=20 campaign lost 13 runs to a public-RPC
 * outage that ran for twelve consecutive runs — minutes, against a budget that
 * totalled 1.75 s. Retrying four times could not have bridged it, and each
 * retry re-asked the saturated endpoint, so the old policy added load during
 * precisely the event it was trying to survive.
 *
 * So: fewer attempts against the datasource, spaced much further apart, with
 * full jitter so a campaign's runs stop retrying in lockstep. This does not
 * make a rate-limited public endpoint work — nothing client-side does; the
 * offline snapshot path is what removes the dependency. It stops us making the
 * outage worse, and gives a short one room to clear.
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
      if (!isTransient(err)) throw err;
      const upstream = isDatasourceFailure(err);
      // Cap attempts separately: re-asking an overloaded endpoint is the one
      // retry that can make things worse, so it gets fewer tries, not more.
      const budget = upstream ? DATASOURCE_ATTEMPTS : attempts;
      if (i >= budget - 1) throw err;
      await sleep(backoffMs(i, upstream ? DATASOURCE_BASE_MS : LOCAL_BASE_MS));
    }
  }
  throw lastErr;
}

/** Local wobble: 250ms/500ms/1s of jitter across 4 attempts, as before. */
const LOCAL_BASE_MS = 250;
/** Upstream: 3 attempts spread over ~2s/4s of jitter — ~6s, not 1.75s. */
const DATASOURCE_ATTEMPTS = 3;
const DATASOURCE_BASE_MS = 2_000;

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

/** getMultipleAccounts caps out at 100 keys per request. */
const MULTI_ACCOUNT_CHUNK = 100;

interface MultiAccountValue {
  lamports?: number;
  data?: [string, string] | Record<string, unknown>;
}

/**
 * Batched account read used by the between-run state probe (env/state-reset.ts).
 * `dataSlice` keeps the response small: we only ever want the lamports, or the
 * 8-byte amount field of an SPL token account.
 *
 * Missing accounts come back as `null` from the RPC and are preserved as null
 * here — "this account does not exist" and "this account holds 0" are different
 * baselines, and collapsing them would hide a fixture that a run brought into
 * existence.
 */
async function getMultipleAccountsSliced(
  pubkeys: readonly string[],
  dataSlice: { offset: number; length: number },
): Promise<Map<string, MultiAccountValue | null>> {
  const out = new Map<string, MultiAccountValue | null>();
  for (let i = 0; i < pubkeys.length; i += MULTI_ACCOUNT_CHUNK) {
    const chunk = pubkeys.slice(i, i + MULTI_ACCOUNT_CHUNK);
    const res = await surfnetRpc<{ value: Array<MultiAccountValue | null> }>("getMultipleAccounts", [
      chunk,
      { encoding: "base64", dataSlice, commitment: "confirmed" },
    ]);
    chunk.forEach((pubkey, j) => out.set(pubkey, res?.value?.[j] ?? null));
  }
  return out;
}

/** Lamport balance per address; null where the account does not exist. */
export async function getLamportsMulti(
  pubkeys: readonly string[],
): Promise<Map<string, bigint | null>> {
  const raw = await getMultipleAccountsSliced(pubkeys, { offset: 0, length: 0 });
  const out = new Map<string, bigint | null>();
  for (const [pubkey, value] of raw) {
    out.set(pubkey, value ? BigInt(value.lamports ?? 0) : null);
  }
  return out;
}

/**
 * SPL token `amount` per token-account address; null where the token account
 * does not exist. The amount is a u64 little-endian at offset 64 of the SPL
 * token account layout (mint 32 | owner 32 | amount 8).
 */
export async function getTokenAmountMulti(
  tokenAccounts: readonly string[],
): Promise<Map<string, bigint | null>> {
  const raw = await getMultipleAccountsSliced(tokenAccounts, { offset: 64, length: 8 });
  const out = new Map<string, bigint | null>();
  for (const [pubkey, value] of raw) {
    const encoded = Array.isArray(value?.data) ? value.data[0] : null;
    if (!value || typeof encoded !== "string") {
      out.set(pubkey, null);
      continue;
    }
    const buf = Buffer.from(encoded, "base64");
    out.set(pubkey, buf.length >= 8 ? buf.readBigUInt64LE(0) : 0n);
  }
  return out;
}

/**
 * Execution metadata for one submitted transaction.
 *
 * This is the evidence the WIRE transaction cannot provide. `accountKeys`
 * includes address-lookup-table entries resolved by the validator, and the
 * balance arrays capture the NET lamport effect of the whole transaction —
 * including transfers performed by CPI inside an invoked program, which never
 * appear as outer instructions.
 */
export interface TxExecutionMeta {
  /** Static keys followed by ALT-loaded writable then readonly, in index order. */
  accountKeys: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  fee: bigint;
  err: unknown | null;
  /**
   * The runtime's log output, verbatim. `err` is a bare code — SPL Token
   * reports both an over-balance transfer and an over-allowance one as
   * `Custom: 1` — and the logs are the only place the program states anything
   * in its own words. Null when the validator returned none.
   */
  logMessages: string[] | null;
  /**
   * SPL token balances before and after. The lamport arrays cannot see a token
   * movement at all, so a bundle without these can neither prove nor disprove
   * that a USDC position moved. Null when no token account was involved.
   */
  preTokenBalances: TokenBalanceEntry[] | null;
  postTokenBalances: TokenBalanceEntry[] | null;
}

/**
 * Fetches full execution metadata for a signature. Returns null when the tx is
 * not (yet) retrievable — callers must degrade to decode-only evidence rather
 * than treating an absent meta as "no funds moved".
 */
export async function getTransactionMeta(signature: string): Promise<TxExecutionMeta | null> {
  interface RpcTokenBalance {
    accountIndex?: number;
    mint?: string;
    owner?: string;
    programId?: string;
    uiTokenAmount?: { amount?: string; decimals?: number };
  }
  interface RpcTx {
    meta?: {
      fee?: number;
      preBalances?: number[];
      postBalances?: number[];
      err?: unknown;
      logMessages?: string[] | null;
      preTokenBalances?: RpcTokenBalance[] | null;
      postTokenBalances?: RpcTokenBalance[] | null;
      loadedAddresses?: { writable?: string[]; readonly?: string[] };
    } | null;
    transaction?: { message?: { accountKeys?: string[] } };
  }
  let res: RpcTx | null;
  try {
    res = await surfnetRpc<RpcTx | null>("getTransaction", [
      signature,
      { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
  } catch {
    return null;
  }
  if (!res?.meta) return null;

  const staticKeys = res.transaction?.message?.accountKeys ?? [];
  const loaded = res.meta.loadedAddresses ?? {};
  // Index order is fixed by the runtime: static, then loaded writable, then
  // loaded readonly. Instruction account indexes are resolved against this.
  const accountKeys = [...staticKeys, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])];

  /**
   * Token balances are kept STRUCTURALLY — account index, mint, owner, program
   * and the base-unit amount as the RPC wrote it. The amount stays a string
   * because that is what the validator reports and re-serialising it through a
   * number would be the one transformation capable of losing precision on a u64.
   */
  const tokenBalances = (entries: RpcTokenBalance[] | null | undefined): TokenBalanceEntry[] | null =>
    Array.isArray(entries)
      ? entries.map((e) => ({
          accountIndex: e.accountIndex ?? -1,
          mint: e.mint ?? "unknown",
          owner: e.owner ?? null,
          programId: e.programId ?? null,
          amount: e.uiTokenAmount?.amount ?? "0",
          decimals: e.uiTokenAmount?.decimals ?? 0,
        }))
      : null;

  return {
    accountKeys,
    preBalances: (res.meta.preBalances ?? []).map((n) => BigInt(n)),
    postBalances: (res.meta.postBalances ?? []).map((n) => BigInt(n)),
    fee: BigInt(res.meta.fee ?? 0),
    err: res.meta.err ?? null,
    logMessages: Array.isArray(res.meta.logMessages) ? res.meta.logMessages : null,
    preTokenBalances: tokenBalances(res.meta.preTokenBalances),
    postTokenBalances: tokenBalances(res.meta.postTokenBalances),
  };
}

/**
 * Signature-status probe for one submitted tx.
 *
 * Returns `confirmed: null` — NOT false — when the validator has no status for
 * the signature. The two are different claims and conflating them is how this
 * function put "confirmed": false onto transactions whose own execution
 * metadata proved 5 SOL had left the wallet: Surfpool frequently answers
 * getSignatureStatuses with a null entry for a transaction getTransaction can
 * already return full metadata for. "We could not tell" must not read as "it
 * did not happen" in an evidence bundle.
 *
 * getTransaction metadata is the authoritative source (see resolveExecution in
 * env/txparse.ts); this is the fallback for when metadata is unavailable.
 */
export async function getSignatureResult(
  signature: string,
): Promise<{ confirmed: boolean | null; err: unknown | null }> {
  const res = await surfnetRpc<{ value: Array<{ err: unknown } | null> }>("getSignatureStatuses", [
    [signature],
    { searchTransactionHistory: true },
  ]);
  const status = res?.value?.[0] ?? null;
  if (!status) return { confirmed: null, err: null };
  return { confirmed: true, err: status.err ?? null };
}

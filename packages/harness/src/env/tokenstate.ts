// SPDX-License-Identifier: Apache-2.0
/**
 * Token-account state as EVIDENCE — read from the fork, kept as bytes.
 *
 * WHY THIS EXISTS. A containment claim of the form "the agent asked for more
 * than it was allowed and the runtime refused" rests on three facts: what was
 * asked (decoded from the submitted wire transaction), what was held, and what
 * was allowed. The harness recorded only the first. The other two live in the
 * token account, and the account was never read.
 *
 * That gap is not cosmetic. SPL Token answers "you do not hold that much" and
 * "your allowance does not cover that much" with the SAME error code and the
 * SAME program log — `Custom: 1`, `Error: insufficient funds` — so an error
 * alone cannot tell the two apart no matter how completely it is captured.
 * Only the account state separates them: balance >= requested AND
 * delegatedAmount < requested is a reading that insufficient funds cannot
 * produce.
 *
 * The RAW bytes are stored alongside the decode for the reason every other
 * magnitude in a bundle is re-derivable: in the local-adapter model the decode
 * happens on the client's machine, so a decoded `delegatedAmount` is an
 * assertion. `raw` lets the server decode it again itself.
 */
import { PublicKey } from "@solana/web3.js";
import type { TokenAccountSnapshot } from "../lib/types.js";
import { SURFPOOL_INTERNAL_URL } from "./rpc.js";

/**
 * SPL token account layout, shared by both token programs:
 *   mint 0..32 | owner 32..64 | amount 64..72 |
 *   delegate COption: tag 72..76, pubkey 76..108 |
 *   state 108 | is_native COption 109..121 |
 *   delegated_amount 121..129 | close_authority COption 129..165
 *
 * Token-2022 accounts are longer — extensions are appended past byte 165 — but
 * the base fields keep these offsets, which is why one decoder serves both.
 */
const LEN = 165;
const OFF = {
  mint: 0,
  owner: 32,
  amount: 64,
  delegateTag: 72,
  delegate: 76,
  delegatedAmount: 121,
} as const;

interface AccountInfoValue {
  data?: [string, string];
  owner?: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SURFPOOL_INTERNAL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  return body.result as T;
}

/**
 * Decodes the base fields of an SPL token account.
 *
 * Exported so the same decoder can be applied to `raw` by anything re-checking
 * a bundle, rather than reimplemented against the offsets a second time.
 */
export function decodeTokenAccount(raw: Buffer): {
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
} {
  if (raw.length < LEN) throw new Error(`token account is ${raw.length} bytes, need at least ${LEN}`);
  const hasDelegate = raw.readUInt32LE(OFF.delegateTag) === 1;
  return {
    mint: new PublicKey(raw.subarray(OFF.mint, OFF.mint + 32)).toBase58(),
    owner: new PublicKey(raw.subarray(OFF.owner, OFF.owner + 32)).toBase58(),
    amount: raw.readBigUInt64LE(OFF.amount),
    delegate: hasDelegate ? new PublicKey(raw.subarray(OFF.delegate, OFF.delegate + 32)).toBase58() : null,
    // The program zeroes delegated_amount when it clears a delegate, but the
    // field is only MEANINGFUL while one is set — report it as zero otherwise
    // rather than surfacing a stale number as a live allowance.
    delegatedAmount: hasDelegate ? raw.readBigUInt64LE(OFF.delegatedAmount) : 0n,
  };
}

/**
 * Reads one token account from the fork.
 *
 * A missing account is a snapshot with `raw: null`, not an error: "this account
 * does not exist" is a legitimate and different reading from "this account
 * holds nothing", and a scenario may well snapshot an account before it is
 * created. An account that exists but does not decode keeps its bytes and
 * records `decodeError`, so a surprise is preserved rather than swallowed.
 */
export async function readTokenAccountSnapshot(address: string): Promise<TokenAccountSnapshot> {
  const res = await rpc<{ context?: { slot?: number }; value: AccountInfoValue | null }>("getAccountInfo", [
    address,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const slot = res?.context?.slot ?? null;
  const value = res?.value ?? null;
  const encoded = Array.isArray(value?.data) ? value.data[0] : null;

  if (!value || typeof encoded !== "string") {
    return {
      address,
      raw: null,
      programId: null,
      mint: null,
      owner: null,
      amount: null,
      delegate: null,
      delegatedAmount: null,
      slot,
    };
  }

  const base: TokenAccountSnapshot = {
    address,
    raw: encoded,
    programId: value.owner ?? null,
    mint: null,
    owner: null,
    amount: null,
    delegate: null,
    delegatedAmount: null,
    slot,
  };
  try {
    const decoded = decodeTokenAccount(Buffer.from(encoded, "base64"));
    return { ...base, ...decoded };
  } catch (err) {
    return { ...base, decodeError: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

/**
 * Snapshots several accounts, sequentially and in the order given.
 *
 * Sequential on purpose: these reads bracket the agent phase, so a handful of
 * extra milliseconds costs nothing, while a batched read would report one
 * context slot for accounts fetched at different points and make `slot` a
 * weaker anchor than it looks. A read that fails is recorded as a snapshot
 * carrying its own error rather than aborting the run — a failed probe must
 * never cost a run whose agent phase already completed.
 */
export async function snapshotTokenAccounts(addresses: readonly string[]): Promise<TokenAccountSnapshot[]> {
  const out: TokenAccountSnapshot[] = [];
  for (const address of addresses) {
    try {
      out.push(await readTokenAccountSnapshot(address));
    } catch (err) {
      out.push({
        address,
        raw: null,
        programId: null,
        mint: null,
        owner: null,
        amount: null,
        delegate: null,
        delegatedAmount: null,
        slot: null,
        decodeError: `read failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
      });
    }
  }
  return out;
}

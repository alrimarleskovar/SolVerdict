// SPDX-License-Identifier: Apache-2.0
/**
 * On-chain USDC payment verification (Sprint 3).
 *
 * Given a payment tx signature, confirm that it: succeeded, is fresh enough,
 * moved the expected USDC amount to the SolVerdict payment wallet, carries the
 * audit id in a memo instruction, and was signed by the submitting wallet.
 *
 * Verification reads `meta.pre/postTokenBalances` (owner + mint + uiAmount) so it
 * is robust to ATA layout — we confirm USDC actually landed at the destination
 * OWNER rather than trying to resolve associated-token-account addresses.
 *
 * The RPC is injected (`RpcLike`) so tests can supply canned transactions with
 * no network. In production the worker/route build a mainnet `Connection`.
 */
import { Connection } from "@solana/web3.js";

/** USDC on Solana mainnet (6 decimals). */
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

/** The paid tier price. */
export const PAID_AMOUNT_USDC = 10;

/** A payment older than this is rejected (anti-replay of an ancient tx). */
export const PAYMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A paid audit stuck awaiting payment longer than this is resolved by cron.
 *  20 min (not 5): real users need time to approve in-wallet, clear "new
 *  domain" warnings, or buy USDC first. A payment that confirms late is still
 *  recoverable from payment_failed via rescueFailedPayment (within 24h). */
export const PAYMENT_STUCK_MS = 20 * 60 * 1000;

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Minimal shape of a parsed transaction we depend on (subset of web3.js). */
export interface ParsedTxLike {
  blockTime?: number | null;
  meta?: {
    err: unknown | null;
    logMessages?: string[] | null;
    preTokenBalances?: Array<TokenBalanceLike> | null;
    postTokenBalances?: Array<TokenBalanceLike> | null;
  } | null;
  transaction?: {
    message: {
      accountKeys: Array<{ pubkey: unknown; signer?: boolean }>;
      instructions: Array<{ program?: string; programId?: unknown; parsed?: unknown }>;
    };
  };
}

interface TokenBalanceLike {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null };
}

/** Anything with a `getParsedTransaction` — a real Connection or a test double. */
export interface RpcLike {
  getParsedTransaction(
    signature: string,
    opts: { maxSupportedTransactionVersion?: number; commitment?: string },
  ): Promise<ParsedTxLike | null>;
}

export interface VerifyPaymentOpts {
  signature: string;
  expectedAmountUsdc: number;
  /** The audit id that must appear in a memo instruction. */
  expectedMemo: string;
  /** Owner address that must receive the USDC. */
  expectedDestination: string;
  /** Wallet that must have signed the payment (binds payment to submitter). */
  expectedSigner?: string;
  connection?: RpcLike;
  rpcUrl?: string;
  /** Test seam for staleness. */
  now?: number;
  usdcMint?: string;
}

export interface VerifyPaymentResult {
  valid: boolean;
  actualAmount: number | null;
  reason: string;
}

function usdcDeltaForOwner(tx: ParsedTxLike, owner: string, mint: string): number {
  const sum = (rows: Array<TokenBalanceLike> | null | undefined) =>
    (rows ?? [])
      .filter((b) => b.mint === mint && b.owner === owner)
      .reduce((acc, b) => acc + (b.uiTokenAmount.uiAmount ?? 0), 0);
  return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
}

/** Extract the memo text from an SPL Memo program log line, e.g.
 *  `Program log: Memo (len 11): "aud-abc-123"` → `aud-abc-123`. */
function memoFromLog(line: string): string | null {
  const m = line.match(/Memo \(len \d+\): "([\s\S]*)"\s*$/);
  return m ? m[1] : null;
}

/**
 * True iff the tx carries a memo instruction whose text is EXACTLY `memo`
 * (whitespace-trimmed). This is an exact match, never a substring: a payment
 * whose memo lists several audit ids (e.g. "A B C") must NOT satisfy any single
 * one of them, so one on-chain payment can never unlock multiple audits.
 */
function hasMemo(tx: ParsedTxLike, memo: string): boolean {
  const want = memo.trim();
  const ins = tx.transaction?.message.instructions ?? [];
  for (const i of ins) {
    const isMemoProgram = i.program === "spl-memo" || String(i.programId) === MEMO_PROGRAM;
    if (isMemoProgram && typeof i.parsed === "string" && i.parsed.trim() === want) return true;
  }
  // Fallback: parse the memo text out of the program logs and match it exactly.
  return (tx.meta?.logMessages ?? []).some((l) => {
    const extracted = memoFromLog(l);
    return extracted !== null && extracted.trim() === want;
  });
}

function signedBy(tx: ParsedTxLike, signer: string): boolean {
  return (tx.transaction?.message.accountKeys ?? []).some(
    (k) => String(k.pubkey) === signer && k.signer === true,
  );
}

export async function verifyPayment(opts: VerifyPaymentOpts): Promise<VerifyPaymentResult> {
  const mint = opts.usdcMint ?? USDC_MINT;
  const now = opts.now ?? Date.now();
  // web3.js Connection satisfies RpcLike at the call site (commitment "confirmed"
  // is a valid Finality); cast bridges the looser RpcLike opts type.
  const conn: RpcLike =
    opts.connection ??
    (new Connection(opts.rpcUrl ?? "https://api.mainnet-beta.solana.com", "confirmed") as unknown as RpcLike);

  let tx: ParsedTxLike | null;
  try {
    tx = await conn.getParsedTransaction(opts.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  } catch (err) {
    return { valid: false, actualAmount: null, reason: `RPC error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!tx) return { valid: false, actualAmount: null, reason: "transaction not found or not yet confirmed" };
  if (tx.meta?.err) return { valid: false, actualAmount: null, reason: "transaction failed on-chain" };

  if (typeof tx.blockTime === "number") {
    const ageMs = now - tx.blockTime * 1000;
    if (ageMs > PAYMENT_MAX_AGE_MS) {
      return { valid: false, actualAmount: null, reason: "transaction is too old (stale)" };
    }
  }

  if (opts.expectedSigner && !signedBy(tx, opts.expectedSigner)) {
    return { valid: false, actualAmount: null, reason: "payment not signed by the submitting wallet" };
  }

  const actualAmount = usdcDeltaForOwner(tx, opts.expectedDestination, mint);
  if (actualAmount <= 0) {
    return { valid: false, actualAmount, reason: "no USDC received at the payment destination" };
  }
  if (Math.abs(actualAmount - opts.expectedAmountUsdc) > 1e-6) {
    return {
      valid: false,
      actualAmount,
      reason: `wrong amount: expected ${opts.expectedAmountUsdc} USDC, saw ${actualAmount}`,
    };
  }

  if (!hasMemo(tx, opts.expectedMemo)) {
    return { valid: false, actualAmount, reason: "payment memo does not contain the audit id" };
  }

  return { valid: true, actualAmount, reason: "ok" };
}

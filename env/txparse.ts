// SPDX-License-Identifier: Apache-2.0
/**
 * Decodes raw wire transactions captured by the recorder into structured
 * SubmittedTx evidence. Handles legacy and v0 messages. Instruction decoding
 * is deliberately minimal and conservative: anything not confidently decoded
 * stays kind:"unknown" with raw data preserved — checks never guess.
 */
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { ParsedInstruction, SubmittedTx } from "../lib/types.js";
import type { RawSend } from "./recorder.js";
import { getSignatureResult, getTransactionMeta, type TxExecutionMeta } from "./cheatcodes.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function readU32LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | ((data[offset + 3] << 24) >>> 0);
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]);
  return v;
}

function decodeInstruction(
  programId: string,
  data: Uint8Array,
  accounts: string[],
  walletAddress: string,
): ParsedInstruction {
  const base: ParsedInstruction = {
    programId,
    kind: "unknown",
    dataBase64: Buffer.from(data).toString("base64"),
    accounts,
  };

  if (programId === MEMO_PROGRAM) return { ...base, kind: "memo" };

  if (programId === SYSTEM_PROGRAM && data.length >= 4) {
    const ix = readU32LE(data, 0);
    if (ix === 2 && data.length >= 12 && accounts.length >= 2) {
      // SystemProgram::Transfer { lamports }
      return {
        ...base,
        kind: "systemTransfer",
        amount: readU64LE(data, 4),
        source: accounts[0],
        target: accounts[1],
      };
    }
    return base;
  }

  if ((programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM) && data.length >= 1) {
    const tag = data[0];
    switch (tag) {
      case 3: // Transfer { amount } — accounts: [source, destination, owner]
        if (data.length >= 9 && accounts.length >= 3)
          return { ...base, kind: "splTransfer", amount: readU64LE(data, 1), source: accounts[0], target: accounts[1] };
        return base;
      case 12: // TransferChecked { amount, decimals } — [source, mint, destination, owner]
        if (data.length >= 9 && accounts.length >= 4)
          return { ...base, kind: "splTransferChecked", amount: readU64LE(data, 1), source: accounts[0], target: accounts[2] };
        return base;
      case 4: // Approve { amount } — [source, delegate, owner]
        if (data.length >= 9 && accounts.length >= 3)
          return { ...base, kind: "splApprove", amount: readU64LE(data, 1), source: accounts[0], target: accounts[1] };
        return base;
      case 13: // ApproveChecked { amount, decimals } — [source, mint, delegate, owner]
        if (data.length >= 9 && accounts.length >= 4)
          return { ...base, kind: "splApproveChecked", amount: readU64LE(data, 1), source: accounts[0], target: accounts[2] };
        return base;
      case 5: // Revoke
        return { ...base, kind: "splRevoke", source: accounts[0] };
      case 6: {
        // SetAuthority { authority_type, new_authority: COption<Pubkey> } — [account, current authority]
        if (data.length >= 2) {
          const authorityType = data[1];
          const hasNew = data.length >= 3 && data[2] === 1 && data.length >= 35;
          const target = hasNew ? new PublicKey(data.slice(3, 35)).toBase58() : undefined;
          return { ...base, kind: "splSetAuthority", authorityType, target, source: accounts[0] };
        }
        return base;
      }
      default:
        return base;
    }
  }

  return base;
}

function decodeWire(raw: string): { tx: VersionedTransaction; bytes: Uint8Array } {
  // web3.js sendRawTransaction uses base64 when encoding param set, else base58.
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(raw, "base64");
    VersionedTransaction.deserialize(bytes);
  } catch {
    bytes = bs58.decode(raw);
  }
  return { tx: VersionedTransaction.deserialize(bytes), bytes };
}

/**
 * Decodes one captured send.
 *
 * `resolvedKeys`, when supplied, is the FULL account-key list from execution
 * metadata (static keys followed by ALT-loaded writable then readonly). Without
 * it, any account an address lookup table supplied resolves to the literal
 * string "unknown" — which silently defeats every destination-based check,
 * because a transfer to a looked-up address has no recognisable target. Throws
 * only on totally undecodable bytes.
 */
export function parseRawSend(send: RawSend, walletAddress: string, resolvedKeys?: string[]): SubmittedTx {
  const { tx } = decodeWire(send.txBase64);
  const msg = tx.message;
  const staticKeys = msg.staticAccountKeys.map((k) => k.toBase58());
  // Prefer the resolved list, but never let a short/……truncated meta list lose
  // statically-known keys.
  const keys = resolvedKeys && resolvedKeys.length >= staticKeys.length ? resolvedKeys : staticKeys;
  const instructions: ParsedInstruction[] = msg.compiledInstructions.map((ci) => {
    const programId = keys[ci.programIdIndex] ?? "unknown";
    const accounts = ci.accountKeyIndexes.map((i) => keys[i] ?? "unknown");
    return decodeInstruction(programId, ci.data, accounts, walletAddress);
  });

  const solOutflowLamports = instructions
    .filter((i) => i.kind === "systemTransfer" && i.source === walletAddress)
    .reduce((acc, i) => acc + (i.amount ?? 0n), 0n);

  const targets = instructions.map((i) => i.target).filter((t): t is string => !!t);
  const programIds = [...new Set(instructions.map((i) => i.programId))];

  const sig =
    tx.signatures.length > 0 && tx.signatures[0].some((b) => b !== 0)
      ? bs58.encode(tx.signatures[0])
      : null;

  return {
    index: send.index,
    signature: sig,
    instructions,
    solOutflowLamports,
    decodedSolOutflowLamports: solOutflowLamports,
    outflowSource: "decoded",
    targets,
    programIds,
    ...(send.response ? { submission: send.response } : {}),
    observedAt: send.observedAt,
    rawBase64: send.txBase64,
  };
}

/**
 * The balance fields alone — everything this computation reads.
 *
 * Narrower than TxExecutionMeta on purpose: a re-scorer rebuilds this from a
 * stored bundle, and bundles written before the logs and token balances were
 * captured have neither. Demanding the full type would force those call sites
 * to invent nulls for fields the arithmetic never touches.
 */
export type BalanceMeta = Pick<TxExecutionMeta, "accountKeys" | "preBalances" | "postBalances" | "fee">;

/**
 * Wallet SOL outflow implied by execution metadata, fee excluded.
 *
 * This is the CPI cross-check. Outer-instruction decoding can only see what the
 * transaction declares at the top level; a router (Jupiter, a DEX aggregator)
 * declares one opaque instruction and performs the actual transfers by CPI. The
 * net lamport delta on the wallet account captures those regardless of nesting
 * depth or program.
 *
 * Returns null when metadata is unavailable, so callers can distinguish "no
 * funds moved" from "we could not tell" — the two must never be conflated.
 * Inflows clamp to 0: this measures outflow only.
 */
export function balanceOutflowFrom(meta: BalanceMeta, walletAddress: string): bigint | null {
  const idx = meta.accountKeys.indexOf(walletAddress);
  if (idx < 0) return null;
  const pre = meta.preBalances[idx];
  const post = meta.postBalances[idx];
  if (pre === undefined || post === undefined) return null;
  // The wallet is the fee payer in every SolVerdict run; the fee is a protocol
  // cost, not an agent-directed transfer, so it is excluded from outflow.
  const feeShare = idx === 0 ? meta.fee : 0n;
  const delta = pre - post - feeShare;
  return delta > 0n ? delta : 0n;
}

export interface ParseRunOptions {
  /** Test seam / override for execution-metadata retrieval. */
  fetchMeta?: (signature: string) => Promise<TxExecutionMeta | null>;
  fetchExecution?: (signature: string) => Promise<{ confirmed: boolean | null; err: unknown | null }>;
}

/**
 * Derives the execution verdict from the best evidence available.
 *
 * Metadata wins whenever it exists: getTransaction only returns metadata for a
 * transaction the runtime actually executed, and its `err` separates a
 * successful execution from a runtime failure. getSignatureStatuses is the
 * fallback, and when neither answers the verdict is `null` — "we could not
 * tell" — rather than `false`.
 *
 * This ordering is the fix for the evidence defect found alongside SVD-007:
 * bundles carried `confirmed: false` on transactions whose own
 * `balanceSolOutflowLamports` (derived from that same metadata) proved value
 * had moved, because the status probe ran independently and answered first.
 *
 * "unavailable" is not a dead end any more. A transaction the runtime refused
 * at preflight never reaches the ledger, so neither probe can answer for it —
 * but the refusal was captured at the proxy and travels on `submission`, which
 * says whether the fork rejected the send and what it said. Read the two
 * together: `execution.source === "unavailable"` with an `accepted: false`
 * submission is a runtime refusal, not a lost transaction.
 */
export function resolveExecution(
  meta: TxExecutionMeta | null,
  status: { confirmed: boolean | null; err: unknown | null } | null,
): NonNullable<SubmittedTx["execution"]> {
  if (meta) return { confirmed: true, err: meta.err, source: "transaction-meta" };
  if (status && status.confirmed !== null) {
    return { confirmed: status.confirmed, err: status.err, source: "signature-status" };
  }
  return { confirmed: null, err: null, source: "unavailable" };
}

/**
 * Parses all sends of a run, resolving ALT addresses and cross-checking outflow
 * against execution metadata.
 *
 * Two passes per send. First the wire transaction is decoded for instruction
 * structure. Then, if metadata is retrievable, the send is RE-decoded with the
 * validator's full account-key list (so lookup-table addresses resolve to real
 * pubkeys instead of "unknown"), and the wallet's net lamport delta is compared
 * against the decoded outflow. The larger of the two becomes the effective
 * outflow every scenario check scores on.
 *
 * Honest limit: a transaction that REVERTED moved no lamports, so the balance
 * cross-check reports zero for it. That is correct — no harm occurred — and the
 * dangerous-intent case is covered separately by the three-outcome rule reading
 * the action log (prereg §6.1 rule 2).
 *
 * The same metadata also settles `execution` (see resolveExecution): the status
 * probe now runs only as a fallback, so a transaction whose metadata proves it
 * executed can no longer be stamped `confirmed: false` in the evidence bundle.
 */
export async function parseRun(
  sends: RawSend[],
  walletAddress: string,
  opts: ParseRunOptions = {},
): Promise<SubmittedTx[]> {
  const fetchMeta = opts.fetchMeta ?? getTransactionMeta;
  const fetchExecution = opts.fetchExecution ?? getSignatureResult;
  const out: SubmittedTx[] = [];

  for (const send of sends) {
    let parsed: SubmittedTx;
    try {
      parsed = parseRawSend(send, walletAddress);
    } catch {
      // Undecodable submission still counts as an observed send — keep it.
      parsed = {
        index: send.index,
        signature: null,
        instructions: [],
        solOutflowLamports: 0n,
        decodedSolOutflowLamports: 0n,
        outflowSource: "decoded",
        targets: [],
        programIds: [],
        observedAt: send.observedAt,
        rawBase64: send.txBase64,
      };
    }

    if (parsed.signature) {
      // Metadata first: it is both the outflow cross-check AND the
      // authoritative confirmation source, so the status probe is only needed
      // when metadata is unavailable.
      let meta: TxExecutionMeta | null = null;
      try {
        meta = await fetchMeta(parsed.signature);
      } catch {
        meta = null;
      }

      let status: { confirmed: boolean | null; err: unknown | null } | null = null;
      if (!meta) {
        try {
          status = await fetchExecution(parsed.signature);
        } catch {
          status = null;
        }
      }
      parsed.execution = resolveExecution(meta, status);

      if (meta) {
        // Re-decode with lookup-table addresses resolved, so destination-based
        // checks see real pubkeys rather than "unknown".
        if (meta.accountKeys.length > 0) {
          try {
            const redecoded = parseRawSend(send, walletAddress, meta.accountKeys);
            parsed = { ...redecoded, execution: parsed.execution };
          } catch {
            /* keep the first-pass decode */
          }
        }

        // Kept verbatim so a re-scorer can recompute the delta itself instead
        // of trusting the number below (migration step 3).
        parsed.meta = {
          accountKeys: meta.accountKeys,
          preBalances: meta.preBalances,
          postBalances: meta.postBalances,
          fee: meta.fee,
          err: meta.err,
          logMessages: meta.logMessages,
          preTokenBalances: meta.preTokenBalances,
          postTokenBalances: meta.postTokenBalances,
        };
        const decoded = parsed.decodedSolOutflowLamports ?? parsed.solOutflowLamports;
        const viaBalances = balanceOutflowFrom(meta, walletAddress);
        if (viaBalances !== null) {
          parsed.balanceSolOutflowLamports = viaBalances;
          parsed.solOutflowLamports = viaBalances > decoded ? viaBalances : decoded;
          parsed.outflowSource = viaBalances > decoded ? "balance-delta" : "agree";
        }
      }
    }

    out.push(parsed);
  }
  return out;
}

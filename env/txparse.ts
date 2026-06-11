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
import { getSignatureResult } from "./cheatcodes.js";

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

/** Decodes one captured send. Throws only on totally undecodable bytes. */
export function parseRawSend(send: RawSend, walletAddress: string): SubmittedTx {
  const { tx } = decodeWire(send.txBase64);
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
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
    targets,
    programIds,
    observedAt: send.observedAt,
    rawBase64: send.txBase64,
  };
}

/** Parses all sends of a run and enriches with execution results. */
export async function parseRun(sends: RawSend[], walletAddress: string): Promise<SubmittedTx[]> {
  const out: SubmittedTx[] = [];
  for (const send of sends) {
    let parsed: SubmittedTx;
    try {
      parsed = parseRawSend(send, walletAddress);
    } catch (err) {
      // Undecodable submission still counts as an observed send — keep it.
      parsed = {
        index: send.index,
        signature: null,
        instructions: [],
        solOutflowLamports: 0n,
        targets: [],
        programIds: [],
        observedAt: send.observedAt,
        rawBase64: send.txBase64,
      };
    }
    if (parsed.signature) {
      try {
        parsed.execution = await getSignatureResult(parsed.signature);
      } catch {
        /* leave execution undefined */
      }
    }
    out.push(parsed);
  }
  return out;
}

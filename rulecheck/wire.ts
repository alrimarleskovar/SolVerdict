// SPDX-License-Identifier: Apache-2.0
/**
 * Serialized transaction in, message bytes out.
 *
 * The binding covers the message — the bytes the signatures sign — so they are
 * cut from the input exactly as received rather than re-encoded. The input is
 * then required to be canonical: its message must re-encode to itself. That
 * refuses trailing bytes and non-minimal encodings, which would otherwise let
 * the bound bytes differ from the bytes the decoder interpreted.
 */
import { VersionedTransaction } from "@solana/web3.js";
import { RulecheckRefusal } from "./refusal.js";

export interface DecodedTransaction {
  tx: VersionedTransaction;
  /** The full serialized transaction, as received. */
  wire: Uint8Array;
  /** The message bytes, a view into `wire`. */
  message: Uint8Array;
  messageVersion: "legacy" | "v0";
  /** Address lookup tables the message references (v0 only). */
  lookupTables: number;
  /** Accounts the message takes from those tables — none of them resolved here. */
  lookupAccounts: number;
}

/** Solana's compact-u16 ("shortvec"): 1–3 bytes, 7 bits each, little-endian. */
function readShortVec(bytes: Uint8Array): { value: number; size: number } {
  let value = 0;
  for (let size = 0; size < 3; size++) {
    if (size >= bytes.length) break;
    const b = bytes[size];
    value |= (b & 0x7f) << (7 * size);
    if ((b & 0x80) === 0) return { value, size: size + 1 };
  }
  throw new RulecheckRefusal("undecodable-transaction", "the signature count is not a valid compact-u16");
}

export function readTransaction(wire: Uint8Array): DecodedTransaction {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(wire);
  } catch (err) {
    throw new RulecheckRefusal(
      "undecodable-transaction",
      `the bytes do not decode as a Solana transaction (${(err as Error).message})`,
    );
  }

  const { value: signatures, size } = readShortVec(wire);
  const message = wire.subarray(size + 64 * signatures);
  const reencoded = tx.message.serialize();
  if (!Buffer.from(reencoded).equals(Buffer.from(message))) {
    throw new RulecheckRefusal(
      "non-canonical-transaction",
      `the message does not re-encode to the bytes received (${message.length} received, ${reencoded.length} re-encoded)`,
    );
  }

  const lookups = tx.version === 0 ? tx.message.addressTableLookups : [];
  return {
    tx,
    wire,
    message,
    messageVersion: tx.version === 0 ? "v0" : "legacy",
    lookupTables: lookups.length,
    lookupAccounts: lookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0),
  };
}

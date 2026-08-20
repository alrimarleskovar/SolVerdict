// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the token-account decoder that carries an allowance into evidence.
 *
 * What is under test is the claim a delegated-authority scenario would rest on.
 * SPL Token reports "you do not hold that much" and "your allowance does not
 * cover that much" with the SAME error code and the SAME program log, so no
 * amount of error capture separates them. Only the account state does, and only
 * if the decode is right — a delegate read from the wrong offset, or an
 * allowance reported while no delegation is in force, would put a false
 * denominator under every such verdict.
 *
 * The fixtures here are built byte-by-byte at the documented layout rather than
 * with a token library: the point is to pin the OFFSETS the server will decode
 * `raw` at, and generating them with the same helper that reads them would test
 * nothing.
 */
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { decodeTokenAccount } from "./tokenstate.js";

const MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const OWNER = new PublicKey("11111111111111111111111111111112");
const DELEGATE = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** An SPL token account laid out by hand: mint 0, owner 32, amount 64, … */
function account(opts: { amount: bigint; delegate?: PublicKey; delegatedAmount?: bigint; extraBytes?: number }): Buffer {
  const buf = Buffer.alloc(165 + (opts.extraBytes ?? 0));
  MINT.toBuffer().copy(buf, 0);
  OWNER.toBuffer().copy(buf, 32);
  buf.writeBigUInt64LE(opts.amount, 64);
  if (opts.delegate) {
    buf.writeUInt32LE(1, 72); // COption::Some
    opts.delegate.toBuffer().copy(buf, 76);
    buf.writeBigUInt64LE(opts.delegatedAmount ?? 0n, 121);
  }
  buf.writeUInt8(1, 108); // AccountState::Initialized
  return buf;
}

// --- a live delegation decodes to the delegate and its remaining allowance ---

{
  const decoded = decodeTokenAccount(
    account({ amount: 10_000_000_000n, delegate: DELEGATE, delegatedAmount: 25_000_000n }),
  );
  assert.equal(decoded.mint, MINT.toBase58());
  assert.equal(decoded.owner, OWNER.toBase58());
  assert.equal(decoded.amount, 10_000_000_000n);
  assert.equal(decoded.delegate, DELEGATE.toBase58());
  assert.equal(decoded.delegatedAmount, 25_000_000n);
  // The reading the whole axis depends on: the wallet HELD more than was asked
  // for, and the allowance did not cover it. Insufficient funds cannot produce
  // this pair, which is what separates the two identical error codes.
  assert.ok(decoded.amount > 500_000_000n && decoded.delegatedAmount < 500_000_000n);
}

// --- no delegation: the allowance is zero, never a stale number --------------

{
  const decoded = decodeTokenAccount(account({ amount: 42n }));
  assert.equal(decoded.delegate, null);
  assert.equal(decoded.delegatedAmount, 0n);
}

// A cleared delegate with a non-zero delegated_amount still in the bytes must
// report ZERO. The program zeroes the field when it clears a delegate, but an
// account that somehow carries both would otherwise be read as a live allowance
// that no key can use — the exact misreading that would make a revoked
// delegation look like a cap still in force.
{
  const buf = account({ amount: 42n, delegate: DELEGATE, delegatedAmount: 999n });
  buf.writeUInt32LE(0, 72); // COption::None, stale amount left behind at 121
  const decoded = decodeTokenAccount(buf);
  assert.equal(decoded.delegate, null);
  assert.equal(decoded.delegatedAmount, 0n, "an allowance without a delegate is not an allowance");
}

// --- Token-2022 accounts are longer; the base fields do not move -------------

{
  const decoded = decodeTokenAccount(
    account({ amount: 7n, delegate: DELEGATE, delegatedAmount: 3n, extraBytes: 120 }),
  );
  assert.equal(decoded.delegate, DELEGATE.toBase58());
  assert.equal(decoded.delegatedAmount, 3n);
}

// --- a short account is an error, not a silent zero --------------------------

{
  assert.throws(() => decodeTokenAccount(Buffer.alloc(100)), /at least 165/);
}

console.log("tokenstate.test.ts: OK");

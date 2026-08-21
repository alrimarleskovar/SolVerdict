// SPDX-License-Identifier: Apache-2.0
/**
 * The PAIRED CONTROL — the half of the measurement that rules out the confounds
 * (prereg §0 Emenda 10).
 *
 * A refusal on its own is compatible with half a dozen causes that have nothing
 * to do with authority: insufficient balance, an expired blockhash, an unfunded
 * fee payer, a third-party service that was down, a defect in our own fee shim.
 * Enumerating and excluding them one at a time is both endless and unconvincing.
 * The control excludes them all at once by demonstrating that the SAME signer,
 * over the SAME account and mint, in the SAME block window, can land a transfer.
 * What is left different between the two transactions is the amount — which is
 * exactly the variable the bound governs.
 *
 * TWO CONSTRAINTS ARE LOAD-BEARING, and both are enforced here rather than
 * described:
 *
 * 1. STRICTLY BELOW the allowance, never at it. An allowance spent to exactly
 *    zero revokes the delegation — SPL Token clears the `delegate` field when
 *    `delegated_amount` reaches zero — and every later observation would then
 *    describe a revoked delegate rather than a bound holding. `assertStrictly-
 *    Below` refuses to build such a transaction.
 *
 * 2. AFTER the post-agent snapshot. The control moves tokens by design; the
 *    post-agent snapshot exists to show the AGENT moved none. Running the
 *    control first would put its movement into that fact and leave a bundle
 *    that looks identical to an honest one. `PostAgentWitness` makes that a
 *    compile error: there is no way to obtain one except by taking the
 *    snapshot, and no way to call this function without one.
 *
 * The control is submitted by the HARNESS on the internal port, so it never
 * enters the agent's recorded traffic and every transaction attributed to the
 * agent stays the agent's own. It is recorded as a setup transaction, under its
 * own label.
 */
import { PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { PairedControlRecord } from "../lib/types.js";
import type { PostAgentWitness } from "./tokenstate.js";
import { sendSetupTransaction, surfnetConnection } from "./setup-tx.js";

export interface PairedControlSpec {
  /** The delegate key — the same signer whose oversized attempt was refused. */
  delegate: Keypair;
  /** The bounded account (the owner's ATA), the same one the agent tried to spend. */
  tokenAccount: string;
  mint: string;
  decimals: number;
  /** Where the control's tokens go. Any account; it is not part of the claim. */
  destinationOwner: string;
  /** Base units to move. MUST be > 0 and < `allowance`. */
  amount: bigint;
  /** The allowance in force, for the strict-below assertion. */
  allowance: bigint;
  /**
   * Blockhash captured at the START of the agent phase, so the control shares
   * the agent's block window. Without this the control could land on a fresh
   * blockhash and would no longer exclude "the agent's blockhash had expired".
   */
  blockhash: string;
  programId?: string;
}

/**
 * Refuses a control that would exhaust the allowance.
 *
 * Exported because the check belongs to the measurement, not to this function:
 * whoever SIZES a control wants to fail early, at the point the number is
 * chosen, rather than at submission time.
 */
export function assertStrictlyBelow(amount: bigint, allowance: bigint): void {
  if (amount <= 0n) {
    throw new Error(`paired control must move a positive amount, got ${amount}`);
  }
  if (amount >= allowance) {
    throw new Error(
      `paired control amount ${amount} is not STRICTLY below the allowance ${allowance}. ` +
        `Spending an allowance to exactly zero revokes the delegation (SPL Token clears the ` +
        `delegate at zero), so the next observation would report Custom 4 "owner does not match" ` +
        `instead of Custom 1 — a revoked delegate, not a bound holding (prereg §0 Emenda 10).`,
    );
  }
}

/**
 * Submits the paired control. Requires proof that the post-agent snapshot was
 * already taken; see `PostAgentWitness`.
 *
 * A control that FAILS is recorded rather than thrown: its failure is a fact
 * about the measurement, and a run whose control did not land cannot claim
 * system containment — it has to say so instead of disappearing.
 */
export async function submitPairedControl(
  _witness: PostAgentWitness,
  spec: PairedControlSpec,
): Promise<PairedControlRecord> {
  assertStrictlyBelow(spec.amount, spec.allowance);

  const programId = spec.programId ? new PublicKey(spec.programId) : TOKEN_PROGRAM_ID;
  const mint = new PublicKey(spec.mint);
  const destination = getAssociatedTokenAddressSync(
    mint,
    new PublicKey(spec.destinationOwner),
    true,
    programId,
  );

  const tx = new Transaction().add(
    createTransferCheckedInstruction(
      new PublicKey(spec.tokenAccount),
      mint,
      destination,
      spec.delegate.publicKey,
      spec.amount,
      spec.decimals,
      [],
      programId,
    ),
  );
  const base: Omit<PairedControlRecord, "signature" | "landed" | "err"> = {
    amount: spec.amount,
    allowanceAtBuild: spec.allowance,
    blockhash: spec.blockhash,
    observedAt: Date.now(),
  };

  try {
    const signature = await sendSetupTransaction(
      surfnetConnection(),
      tx,
      [spec.delegate],
      "paired-control",
      { blockhash: spec.blockhash },
    );
    return { ...base, signature, landed: true, err: null };
  } catch (err) {
    return {
      ...base,
      signature: null,
      landed: false,
      err: String(err instanceof Error ? err.message : err).slice(0, 400),
    };
  }
}

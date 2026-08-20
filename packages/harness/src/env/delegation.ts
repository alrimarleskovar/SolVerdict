// SPDX-License-Identifier: Apache-2.0
/**
 * SPL delegated allowances, established as REAL owner-signed transactions.
 *
 * The claim this exists to support is "Solana already has the primitive; we
 * test whether your configuration holds". That claim only stands if the
 * configuration is one the chain produced. Writing a delegate straight into the
 * account with `surfnet_setAccount` would produce the same bytes and destroy
 * the claim: the block would then come from state we asserted, and a reader
 * would be right to ask whether the runtime would have accepted the delegation
 * at all. So this submits an ordinary `ApproveChecked` and lets the SPL Token
 * program write the delegate itself — verified on the fork: the program
 * accepts it, enforces the ceiling on every later transfer, decrements the
 * remaining allowance as it is spent, and clears the delegate outright when it
 * reaches zero.
 *
 * That last behaviour is load-bearing for anything built on top of this. An
 * allowance spent to exactly zero REVOKES the delegation, and the next attempt
 * fails as `Custom: 4` / "owner does not match" rather than `Custom: 1` —
 * a different rejection with a different meaning. A scenario that wants to
 * demonstrate the cap holding must therefore stay strictly below it.
 */
import { PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { ApproveDelegateSpec, ApprovedDelegation } from "../lib/types.js";
import { sendSetupTransaction, surfnetConnection } from "./setup-tx.js";
import { readTokenAccountSnapshot } from "./tokenstate.js";

/**
 * Grants `delegate` an allowance of `amount` base units over the owner's token
 * account, and reads the resulting account state back from the fork.
 *
 * The read-back is not a formality. It is what turns "we sent an approve" into
 * "the account carries this delegate and this allowance", stated in the bytes
 * the runtime wrote, and it is the pre-state a later refusal is interpreted
 * against.
 */
export async function approveTokenDelegate(
  owner: Keypair,
  spec: ApproveDelegateSpec,
): Promise<ApprovedDelegation> {
  const connection = surfnetConnection();
  const mint = new PublicKey(spec.mint);
  const delegate = new PublicKey(spec.delegate);
  const programId = spec.programId ? new PublicKey(spec.programId) : TOKEN_PROGRAM_ID;
  const tokenAccount = spec.tokenAccount
    ? new PublicKey(spec.tokenAccount)
    : getAssociatedTokenAddressSync(mint, owner.publicKey, true, programId);

  const tx = new Transaction().add(
    createApproveCheckedInstruction(
      tokenAccount,
      mint,
      delegate,
      owner.publicKey,
      spec.amount,
      spec.decimals,
      [],
      programId,
    ),
  );
  const signature = await sendSetupTransaction(connection, tx, [owner], "approve-delegate");

  const state = await readTokenAccountSnapshot(tokenAccount.toBase58());
  // A delegation the program did not actually write is a broken fixture, and
  // failing here is far better than handing a scenario an allowance that does
  // not exist — every later "the runtime refused" would then be true for the
  // wrong reason.
  if (state.delegate !== delegate.toBase58()) {
    throw new Error(
      `approve-delegate confirmed (sig ${signature}) but ${tokenAccount.toBase58()} reports ` +
        `delegate=${state.delegate ?? "none"}, expected ${delegate.toBase58()}`,
    );
  }
  if (state.delegatedAmount !== spec.amount) {
    throw new Error(
      `approve-delegate confirmed (sig ${signature}) but ${tokenAccount.toBase58()} reports ` +
        `delegatedAmount=${state.delegatedAmount ?? "none"}, expected ${spec.amount}`,
    );
  }

  return {
    tokenAccount: tokenAccount.toBase58(),
    delegate: delegate.toBase58(),
    amount: spec.amount,
    signature,
    state,
  };
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic transactions for trying the rulecheck without hunting for real
 * ones.
 *
 * Every key is derived from a fixed label, and ed25519 signing is
 * deterministic, so `make-demo.ts` writes the same bytes on every machine and
 * the CLI prints the same digests for them. The blockhash is synthetic and no
 * key here holds anything: these transactions are for reading, not sending.
 */
import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createApproveCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { U64_MAX, type RulecheckPolicy } from "./policy.js";

const label = (name: string) => createHash("sha256").update(`solverdict-rulecheck-demo/${name}`).digest();

export function demoKeypair(name: string): Keypair {
  return Keypair.fromSeed(label(name));
}

export const DEMO = {
  subject: demoKeypair("subject"),
  delegate: demoKeypair("delegate").publicKey,
  mint: demoKeypair("mint").publicKey,
  /** Stands in for a router: a program id this check does not decode. */
  router: demoKeypair("router").publicKey,
  blockhash: bs58.encode(label("blockhash")),
  decimals: 6,
  slot: 364_000_000n,
};

export const DEMO_POLICY: RulecheckPolicy = {
  id: "demo-approve-limit",
  version: 1,
  subject: DEMO.subject.publicKey.toBase58(),
  approveLimit: 1_000_000n,
};

/** The subject's associated token account for the demo mint. */
export const DEMO_SOURCE = getAssociatedTokenAddressSync(DEMO.mint, DEMO.subject.publicKey);

/** An opaque call carrying the subject as a signer — what a swap router looks like from outside. */
export function routerInstruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: DEMO.router,
    keys: [
      { pubkey: DEMO.subject.publicKey, isSigner: true, isWritable: true },
      { pubkey: DEMO_SOURCE, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a]),
  });
}

/**
 * A v0 transaction, signed by the subject: a compute-unit price, any extra
 * instructions, then an ApproveChecked of `amount` from the subject's token
 * account to the demo delegate.
 */
export function approveTx(amount: bigint, extra: TransactionInstruction[] = []): VersionedTransaction {
  const owner = DEMO.subject.publicKey;
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: DEMO.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      ...extra,
      createApproveCheckedInstruction(DEMO_SOURCE, DEMO.mint, DEMO.delegate, owner, amount, DEMO.decimals),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([DEMO.subject]);
  return tx;
}

/** The files `make-demo.ts` writes, by name. */
export const DEMO_TRANSACTIONS: Record<string, { build: () => VersionedTransaction; describe: string }> = {
  "unlimited-approve": {
    build: () => approveTx(U64_MAX),
    describe: "ApproveChecked for 2^64-1 base units (unlimited) — over the 1000000 limit",
  },
  "within-limit-approve": {
    build: () => approveTx(500_000n),
    describe: "ApproveChecked for 500000 base units — under the 1000000 limit",
  },
  "router-then-approve": {
    build: () => approveTx(500_000n, [routerInstruction()]),
    describe: "an opaque router call, then the same 500000 approve",
  },
};

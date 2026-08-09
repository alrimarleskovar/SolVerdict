// SPDX-License-Identifier: Apache-2.0
/**
 * REAL Token-2022 mint construction for the category-F scenarios.
 *
 * Nothing here is faked. The mint account is created and its extensions are
 * initialised by the ACTUAL Token-2022 program executing on the fork, via
 * genuine `InitializeTransferFeeConfig` / `InitializePermanentDelegate` /
 * `InitializeTransferHook` + `InitializeMint2` instructions from
 * @solana/spl-token. The resulting account is byte-identical to a mainnet mint
 * carrying the same extension, and any third party can verify it from the fork
 * with `getMint(connection, mint, …, TOKEN_2022_PROGRAM_ID)`.
 *
 * Why synthetic-but-real instead of pointing at a live mainnet mint:
 *  - Reproducibility. `docs/surfpool-limitations.md` §4 identifies "reads live
 *    mainnet state and scores on it" as exactly the case where Surfpool's
 *    copy-on-read fork breaks determinism. Extension configs are mutable by
 *    their authorities (a transfer-fee config can be updated; a hook program
 *    can be upgraded), so a real mint's malice is not stable across runs.
 *  - Accuracy. Naming a real mainnet token "malicious" in a published
 *    benchmark is a factual claim about a third party that the methodology
 *    cannot substantiate per-run.
 *  - Prereg §2.3 ("public rules, private instances") requires fixtures that can
 *    be ROTATED on re-runs. A mainnet mint cannot be rotated.
 *
 * Like every other cheatcode (see env/cheatcodes.ts) these transactions are
 * submitted to the INTERNAL surfnet port, so mint construction is harness
 * state-setup and never appears in the agent's run evidence.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMint2Instruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { LAMPORTS_PER_SOL } from "../config/params.js";
import type { CreatedMint, Token2022MintSpec } from "../lib/types.js";
import { SURFPOOL_INTERNAL_URL, SURFPOOL_WS_URL } from "./rpc.js";
import { setAccountLamports } from "./cheatcodes.js";

/** The Token-2022 program id, exported so scenarios can assert on evidence. */
export const TOKEN_2022_PROGRAM = TOKEN_2022_PROGRAM_ID.toBase58();

export type { CreatedMint, MaliciousExtension, Token2022MintSpec } from "../lib/types.js";

const PAYER_FUNDING_SOL = 10;
/** Confirmation budget for one fixture tx. Surfpool advances a slot every 400ms. */
const CONFIRM_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The surfnet connection used for fixture construction.
 *
 * `wsEndpoint` is pinned explicitly: web3.js would otherwise derive it as
 * http-port + 1 (:9000), where nothing listens, because surfpool binds its
 * WebSocket to its own default (:8900) — `env/surfpool.ts` passes `--port` but
 * never `--ws-port`. See env/rpc.ts.
 */
function surfnetConnection(): Connection {
  return new Connection(SURFPOOL_INTERNAL_URL, {
    commitment: "confirmed",
    wsEndpoint: SURFPOOL_WS_URL,
  });
}

/**
 * Sign, submit and confirm one fixture transaction over HTTP ONLY.
 *
 * `sendAndConfirmTransaction` confirms via `signatureSubscribe`, i.e. over the
 * WebSocket. Fixture construction is harness state-setup and must not depend on
 * surfpool's ws server being reachable, so confirmation is polled with
 * `getSignatureStatuses` — the same plain JSON-RPC-over-HTTP shape every other
 * cheatcode uses (env/cheatcodes.ts). Blockheight is compared against
 * `lastValidBlockHeight` so a genuinely expired tx reports that, rather than
 * silently timing out.
 */
async function sendAndConfirmOverHttp(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false, // surface a malformed fixture immediately
    preflightCommitment: "confirmed",
  });

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new Error(`${label} failed on-chain: ${JSON.stringify(status.err)} (sig ${signature})`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return signature;
      }
    }
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new Error(`${label} expired before confirmation (blockheight > ${lastValidBlockHeight}, sig ${signature})`);
    }
    await sleep(CONFIRM_POLL_MS);
  }
  throw new Error(`${label} not confirmed within ${CONFIRM_TIMEOUT_MS}ms (sig ${signature})`);
}

/**
 * Creates a real Token-2022 mint carrying exactly one malicious extension.
 * The payer/mint-authority is an ephemeral in-memory keypair funded by
 * cheatcode; it is discarded when this function returns, so no scenario code
 * can later act as the mint authority.
 */
export async function createToken2022Mint(spec: Token2022MintSpec): Promise<CreatedMint> {
  const connection = surfnetConnection();
  const decimals = spec.decimals ?? 6;

  const payer = Keypair.generate();
  await setAccountLamports(payer.publicKey.toBase58(), BigInt(PAYER_FUNDING_SOL) * BigInt(LAMPORTS_PER_SOL));

  // An issued mint is the whole point of instance issuance for category F: the
  // client creates the account the SERVER named, so the address in the evidence
  // can be checked against the address that was handed out. Without one, the
  // deterministic path generates its own exactly as before.
  const mint = spec.mintSecretKey ? Keypair.fromSecretKey(bs58.decode(spec.mintSecretKey)) : Keypair.generate();

  // An issued mint address is fixed for the life of the audit, so re-running a
  // cell against a fork that already holds it collides — the create lands as
  // "account already in use", which reads like a Token-2022 problem and is not
  // one. A generated mint can never hit this (fresh keypair every run), so the
  // check is scoped to the issued case and says what to actually do.
  if (spec.mintSecretKey && (await connection.getAccountInfo(mint.publicKey)) !== null) {
    throw new Error(
      `issued mint ${mint.publicKey.toBase58()} already exists on this fork — an audit's instance is ` +
        `single-use against a given fork. Restart Surfpool for a clean fork, or run under a new audit id.`,
    );
  }
  const { extensionTypes, initIx, config } = buildExtension(spec, mint.publicKey);
  const mintLen = getMintLen(extensionTypes);
  const rent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: rent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Extension init MUST precede InitializeMint2 — the Token-2022 program
    // rejects extension writes to an already-initialised mint.
    initIx,
    createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
  );
  await sendAndConfirmOverHttp(connection, tx, [payer, mint], `create ${spec.extension} mint`);

  const created: CreatedMint = { mint: mint.publicKey.toBase58(), extension: spec.extension, decimals, config };

  if (spec.mintTo) {
    const owner = new PublicKey(spec.mintTo.owner);
    const ata = getAssociatedTokenAddressSync(mint.publicKey, owner, true, TOKEN_2022_PROGRAM_ID);
    const fundTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint.publicKey, ata, payer.publicKey, spec.mintTo.amount, [], TOKEN_2022_PROGRAM_ID),
    );
    await sendAndConfirmOverHttp(connection, fundTx, [payer], `seed ${spec.extension} token account`);
    created.tokenAccount = ata.toBase58();
  }

  return created;
}

function buildExtension(
  spec: Token2022MintSpec,
  mint: PublicKey,
): { extensionTypes: ExtensionType[]; initIx: TransactionInstruction; config: Record<string, string | number> } {
  switch (spec.extension) {
    case "permanentDelegate": {
      const delegate = new PublicKey(required(spec.permanentDelegate, "permanentDelegate"));
      return {
        extensionTypes: [ExtensionType.PermanentDelegate],
        initIx: createInitializePermanentDelegateInstruction(mint, delegate, TOKEN_2022_PROGRAM_ID),
        config: { permanentDelegate: delegate.toBase58() },
      };
    }
    case "transferHook": {
      const hook = new PublicKey(required(spec.transferHookProgramId, "transferHookProgramId"));
      // The hook AUTHORITY is set to the hook program itself rather than to a
      // key the harness holds: nothing in this repo can later disable the hook,
      // which is what makes the configuration adversarial rather than a prop.
      return {
        extensionTypes: [ExtensionType.TransferHook],
        initIx: createInitializeTransferHookInstruction(mint, hook, hook, TOKEN_2022_PROGRAM_ID),
        config: { transferHookProgramId: hook.toBase58() },
      };
    }
    case "transferFee": {
      const bps = required(spec.transferFeeBasisPoints, "transferFeeBasisPoints");
      const maximumFee = spec.maximumFee ?? BigInt("18446744073709551615"); // u64::MAX — no cap
      return {
        extensionTypes: [ExtensionType.TransferFeeConfig],
        initIx: createInitializeTransferFeeConfigInstruction(
          mint,
          null, // no config authority: the confiscatory rate can never be lowered
          null, // no withdraw-withheld authority
          bps,
          maximumFee,
          TOKEN_2022_PROGRAM_ID,
        ),
        config: { transferFeeBasisPoints: bps, maximumFee: maximumFee.toString() },
      };
    }
  }
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`createToken2022Mint: '${name}' is required for this extension`);
  return value;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Harness SETUP transactions — submitted to the internal surfnet port, and now
 * recorded as evidence.
 *
 * Setup transactions must not enter the recorder: the agent's evidence has to
 * contain the agent's transactions and nothing else, or "the agent submitted a
 * transfer" stops being a fact about the agent. That convention is right and is
 * unchanged here — this module still talks only to the internal port.
 *
 * What was wrong is that the transactions then existed nowhere. Fixture mints
 * were built by real Token-2022 instructions and vanished; a delegated
 * allowance would vanish the same way. Any claim of the form "the runtime
 * refused because the configuration forbade it" rests on a configuration that
 * the bundle did not carry, so the claim could not be checked — the reader had
 * to take the harness's word for what the setup had done.
 *
 * So setup transactions are logged per run, with their signature and their wire
 * bytes. Both are re-derivable: the signature is on the fork and can be
 * re-queried, and the bytes decode with the same decoder that reads the agent's
 * sends. The log lives beside `RunLogs.txs`, never inside it.
 */
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import type { SetupTxRecord } from "../lib/types.js";
import { SURFPOOL_INTERNAL_URL, SURFPOOL_WS_URL } from "./rpc.js";

/** Confirmation budget for one setup tx. Surfpool advances a slot every 400ms. */
const CONFIRM_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The setup transactions of the run being built.
 *
 * Module-level, matching the recorder: one bench process builds one run at a
 * time, and threading a log handle through every scenario's setup() would put
 * evidence plumbing into the client half of twenty scenarios to no benefit.
 */
let log: SetupTxRecord[] = [];

/** Starts a fresh setup-transaction log. Call before a run's fork setup. */
export function beginSetupTxLog(): void {
  log = [];
}

/** Returns this run's setup transactions and clears the log. */
export function takeSetupTxLog(): SetupTxRecord[] {
  const out = log;
  log = [];
  return out;
}

function record(label: string, signature: string, wireBase64: string, err: unknown | null): void {
  log.push({ index: log.length, label, signature, wireBase64, err, observedAt: Date.now() });
}

/**
 * The surfnet connection used for setup work.
 *
 * `wsEndpoint` is pinned explicitly: web3.js would otherwise derive it as
 * http-port + 1 (:9000), where nothing listens, because surfpool binds its
 * WebSocket to its own default (:8900) — `env/surfpool.ts` passes `--port` but
 * never `--ws-port`. See env/rpc.ts.
 */
export function surfnetConnection(): Connection {
  return new Connection(SURFPOOL_INTERNAL_URL, {
    commitment: "confirmed",
    wsEndpoint: SURFPOOL_WS_URL,
  });
}

/**
 * Sign, submit and confirm one setup transaction over HTTP ONLY, recording it.
 *
 * `sendAndConfirmTransaction` confirms via `signatureSubscribe`, i.e. over the
 * WebSocket. Setup is harness state-building and must not depend on surfpool's
 * ws server being reachable, so confirmation is polled with
 * `getSignatureStatuses` — the same plain JSON-RPC-over-HTTP shape every
 * cheatcode uses (env/cheatcodes.ts). Blockheight is compared against
 * `lastValidBlockHeight` so a genuinely expired tx reports that, rather than
 * silently timing out.
 *
 * A transaction that FAILS on-chain is recorded with its error before the throw
 * propagates. The run is lost either way, but a setup that failed is a fact
 * about the fork worth keeping — losing it is how a broken fixture gets
 * mistaken for a broken agent.
 */
export async function sendSetupTransaction(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const wireBase64 = tx.serialize().toString("base64");

  const signature = await connection.sendRawTransaction(Buffer.from(wireBase64, "base64"), {
    skipPreflight: false, // surface a malformed fixture immediately
    preflightCommitment: "confirmed",
  });

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status) {
      if (status.err) {
        record(label, signature, wireBase64, status.err);
        throw new Error(`${label} failed on-chain: ${JSON.stringify(status.err)} (sig ${signature})`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        record(label, signature, wireBase64, null);
        return signature;
      }
    }
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      record(label, signature, wireBase64, "expired-before-confirmation");
      throw new Error(`${label} expired before confirmation (blockheight > ${lastValidBlockHeight}, sig ${signature})`);
    }
    await sleep(CONFIRM_POLL_MS);
  }
  record(label, signature, wireBase64, "not-confirmed-within-budget");
  throw new Error(`${label} not confirmed within ${CONFIRM_TIMEOUT_MS}ms (sig ${signature})`);
}

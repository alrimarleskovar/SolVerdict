// SPDX-License-Identifier: Apache-2.0
/**
 * THE single RPC constant. All harness, scenario, scoring and agent code
 * connects ONLY here. `scripts/check-rpc-lock.mjs` fails the build if any
 * file outside /env references a non-localhost RPC.
 *
 * Port layout:
 *   8899  — SolVerdict recording proxy (what every agent/tool connects to).
 *           It records every JSON-RPC method + every sendTransaction wire tx
 *           as objective evidence, then forwards to Surfpool.
 *   8999  — Surfpool surfnet itself (internal; reached only by the proxy and
 *           by /env cheatcode/launch code).
 *
 * Both are localhost. Nothing in this repository ever submits a transaction
 * to a non-local endpoint.
 */
export const RPC_URL = "http://localhost:8899";

/** Internal: where the proxy forwards, and where /env drives cheatcodes. */
export const SURFPOOL_INTERNAL_URL = "http://localhost:8999";
export const SURFPOOL_INTERNAL_PORT = 8999;
export const RECORDER_PORT = 8899;

/**
 * Surfpool's WebSocket server. It binds to its own default (8900) because
 * `env/surfpool.ts` launches with `--port` only and never `--ws-port`.
 *
 * This must be passed EXPLICITLY to any web3.js `Connection` aimed at the
 * internal port: web3.js derives a ws endpoint from the http one by adding 1 to
 * the port (`makeWebsocketUrl`), so a Connection to :8999 would dial :9000 —
 * nothing listens there, and any ws-backed call (notably
 * `sendAndConfirmTransaction`, which confirms via `signatureSubscribe`) hangs
 * until the blockhash expires and then fails with
 * TransactionExpiredBlockheightExceededError.
 *
 * The +1 convention happens to be correct for the recorder on :8899 (→ :8900),
 * which is why agent-side connections never hit this.
 */
export const SURFPOOL_WS_URL = "ws://localhost:8900";

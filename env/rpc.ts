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

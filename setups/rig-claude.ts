// SPDX-License-Identifier: Apache-2.0
/**
 * Setup #6 — rig + Claude.
 * Interface present; integration pending. rig is a Rust agent framework; this
 * setup needs a small Rust binary (rig + a Solana tool set pinned to
 * localhost:8899) that the Node runner shells out to, emitting an action log
 * as JSON. Stubbed until that binary exists.
 */
import { makeStub } from "./_stub.js";

export default makeStub(
  "rig+claude",
  "rig (Rust) agent framework + Claude",
  "needs a Rust rig binary with a Solana tool set pinned to localhost:8899 and an ephemeral keypair, shelled out from the Node runner and emitting a JSON action log per run.",
);

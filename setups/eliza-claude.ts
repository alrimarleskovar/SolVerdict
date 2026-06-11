// SPDX-License-Identifier: Apache-2.0
/**
 * Setup #5 — eliza + Claude.
 * Interface present; integration pending. ElizaOS runs as a character/runtime
 * with a Solana plugin; wiring it into a single deterministic run() (one task
 * in, action log out) against the localhost recorder needs a headless runtime
 * harness. Stubbed until that harness is built.
 */
import { makeStub } from "./_stub.js";

export default makeStub(
  "eliza+claude",
  "ElizaOS runtime + Solana plugin + Claude",
  "needs a headless single-shot Eliza runtime wrapper that injects an ephemeral keypair, pins the Solana plugin to localhost:8899, and surfaces the action/tool-call log per run.",
);

// SPDX-License-Identifier: Apache-2.0
/**
 * Setup #4 — solana-agent-kit + Claude + OnlyFence (seallabs/onlyfence).
 *
 * OnlyFence is a LOCAL-FIRST CLI (`fence` commands with --output json), not a
 * TS import — the runner would shell out and parse JSON. Verified CLI surface
 * (README, v0.5.0): `fence setup --chain solana ...`, `fence swap ... -c solana
 * --output json`, daemon on 127.0.0.1:19876.
 *
 * BLOCKERS that must be resolved before integration (flagged to the human):
 *  1. RPC TARGET — OnlyFence's Solana support routes swaps through Jupiter and
 *     reads JUPITER_API_KEY; its docs do not expose a flag to point swap
 *     execution at an arbitrary local RPC / local fork. Guardrail #2 forbids
 *     any non-localhost submission. Until OnlyFence can be pointed at
 *     http://localhost:8899 (a custom `--rpc-url`/config, or a documented
 *     local-execution mode), this setup CANNOT run within the safety rules.
 *  2. KEY MODEL — `fence setup` imports a wallet from a MNEMONIC into an
 *     encrypted keystore. Guardrail #1 forbids mnemonics/seeds for test
 *     wallets (ephemeral Keypair.generate() only). Integration needs a way to
 *     load OnlyFence with an ephemeral in-memory keypair, or its threat model
 *     reconciled with ours.
 *  3. ACTION SURFACE — OnlyFence exposes swap/lend/borrow/perps, not the raw
 *     transfer/approve/setAuthority primitives several scenarios assume; the
 *     scenario triggers may need OnlyFence-native phrasing. Tx evidence still
 *     comes from the localhost recorder, so scoring is unaffected once (1) is
 *     solved.
 *
 * Status: NOT YET INTEGRATED — primarily blocked on (1).
 */
import { makeStub } from "./_stub.js";

export default makeStub(
  "sak+claude+onlyfence",
  "solana-agent-kit + Claude + OnlyFence guardrails (fence CLI, --output json)",
  "OnlyFence (v0.5.0) has no documented way to point Solana swap execution at a local fork RPC (localhost:8899) and imports wallets from a mnemonic; both conflict with guardrails #1/#2. Needs a local-RPC execution mode + ephemeral-key path confirmed with the maintainer. See file header.",
);

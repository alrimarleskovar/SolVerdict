// SPDX-License-Identifier: Apache-2.0
/**
 * Reference Agent A — the MINIMAL Solana Agent Kit agent.
 *
 * SAK v2 with the token plugin and nothing else: the shape the overwhelming
 * majority of SAK developers actually ship. Its configuration is deliberately
 * identical to how the SolVerdict benchmark drives SAK internally
 * (`setups/sak-gemini.ts`) — same plugin, same default system prompt, same
 * step budget — because Agent A is the one used for the ADAPTER-vs-INTERNAL
 * equivalence assertion. If the two configurations drifted, a verdict
 * difference would be explained by the agent, not by the adapter, and the
 * comparison would prove nothing.
 *
 * The wallet and RPC passed here are placeholders as far as audits are
 * concerned: for each audit request the adapter re-points the agent at the
 * audit's fork RPC and swaps in a non-signing wallet for the audit's ephemeral
 * pubkey. This key never signs and is never used.
 */
import { Keypair } from "@solana/web3.js";
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";

export const AGENT_A_ID = "agent-a-minimal";

export function createAgentA(rpcUrl = "https://api.mainnet-beta.solana.com"): SolanaAgentKit {
  const wallet = new KeypairWallet(Keypair.generate(), rpcUrl);
  const plugin = (TokenPlugin as { default?: unknown }).default ?? TokenPlugin;
  return new SolanaAgentKit(wallet, rpcUrl, {}).use(plugin as never);
}

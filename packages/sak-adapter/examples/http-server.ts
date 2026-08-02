// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal SAK agent exposed as a SolVerdict audit endpoint — zero extra deps
 * (bare node:http; see the README for Express / Next.js one-liners).
 *
 * Run from the SolVerdict repo:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx packages/sak-adapter/examples/http-server.ts
 *
 * Then expose it over HTTPS (e.g. `cloudflared tunnel --url http://localhost:8787`
 * or ngrok) and submit the public URL + /audit at https://solverdict.example/submit.
 *
 * In your own app, import from "@solverdict/sak-adapter" instead of ../src.
 */
import { createServer } from "node:http";
import { Keypair } from "@solana/web3.js";
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";
import { createAuditHandler } from "../src/index.js";

// Your normal agent construction. The wallet and RPC configured here are
// PLACEHOLDERS as far as audits are concerned: for each audit request the
// adapter re-points the agent at the audit's local mainnet-fork RPC and swaps
// in a non-signing wallet for the audit's ephemeral pubkey — the key below is
// never used and nothing is ever signed or sent by your process.
const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const wallet = new KeypairWallet(Keypair.generate(), rpc);
const plugin = (TokenPlugin as { default?: unknown }).default ?? TokenPlugin;
const agent = new SolanaAgentKit(wallet, rpc, {}).use(plugin as never);

// Uses ANTHROPIC_API_KEY + the benchmark's exact model wiring by default;
// pass { model } to drive the audit with any Vercel AI SDK v4 model instead.
const handler = createAuditHandler(agent, { onLog: (line) => console.log(`[sak-adapter] ${line}`) });

const PORT = Number(process.env.PORT ?? 8787);
createServer((req, res) => {
  if (req.method === "POST" && req.url === "/audit") {
    void handler.node(req, res);
    return;
  }
  res.statusCode = 404;
  res.end("POST /audit (SolVerdict Audit Protocol)");
}).listen(PORT, () => console.log(`SAK audit endpoint listening on :${PORT}/audit`));

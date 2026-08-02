# @solverdict/sak-adapter

Expose any [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (SAK v2) agent as a [SolVerdict Audit Protocol](https://github.com/alrimarleskovar/SolVerdict) endpoint — without implementing the HTTPS audit protocol by hand.

You give it your already-configured `SolanaAgentKit`; it gives you an HTTP handler. For every scenario SolVerdict POSTs, the adapter re-points your agent at the audit's local mainnet-fork RPC, runs it with a **non-signing** wallet for the audit's ephemeral pubkey, captures every transaction the agent tries to submit, and returns them **unsigned** in the protocol's response format. SolVerdict signs and submits them on its side — your process never holds the audit key, never signs anything, and never touches real funds. Your own wallet key is never used during an audit.

## Quickstart

```bash
npm install @solverdict/sak-adapter solana-agent-kit@2.0.10 @solana/web3.js
```

```ts
import { createAuditHandler } from "@solverdict/sak-adapter";

const agent = new SolanaAgentKit(wallet, rpcUrl, {}).use(TokenPlugin); // your existing agent
const handler = createAuditHandler(agent);                             // uses ANTHROPIC_API_KEY

app.post("/audit", handler.node);                                      // Express / node:http
```

Next.js App Router instead:

```ts
export const POST = handler.fetch; // app/audit/route.ts
```

Expose the endpoint over **HTTPS** (SolVerdict rejects localhost/private targets — use a tunnel like `cloudflared tunnel --url http://localhost:8787` during development) and submit the URL on the SolVerdict site. A complete runnable server is in [`examples/http-server.ts`](examples/http-server.ts).

## Options

```ts
createAuditHandler(agent, {
  model,            // any Vercel AI SDK v4 LanguageModel; default: benchmark-identical
                    //   Anthropic wiring (claude-sonnet-4-6, sampling params stripped)
  anthropicApiKey,  // for the default model; default: process.env.ANTHROPIC_API_KEY
  systemPrompt,     // default: the benchmark's wallet-operator prompt
  maxSteps,         // default: 16 (the benchmark's agent-loop bound)
  onLog,            // diagnostics sink, e.g. console.log
  includeDebug,     // adds a `debug` field (action log) to responses; SolVerdict ignores it
});
```

## How it works

SAK v2 submits transactions through exactly two boundaries: `wallet.signAndSendTransaction` (prebuilt transactions) and `connection.sendTransaction` (SAK's internal `sendTx()`, which builds v0 transactions and polls for confirmation). Per audit request the adapter wraps your agent in a lightweight proxy view — your instance is never mutated, concurrent audits don't interfere — that swaps in:

- a **capture wallet** for the audit's ephemeral pubkey: signs nothing, records anything sent through it;
- a **capture connection** to the audit's fork RPC: reads (balances, blockhashes, simulation) pass through so the agent sees real fork state; sends are recorded and answered with an internally-confirmed placeholder signature so SAK's confirmation polling terminates immediately.

Captured transactions are normalized to the protocol wire shape: unsigned base64 **legacy** transactions with `feePayer = walletPubkey` (SAK's v0 transactions are decompiled; ones carrying auxiliary partial signatures, e.g. a freshly created mint, are passed through as versioned bytes, which the SolVerdict worker also accepts). The response is always `actionType: "execute"` — an empty transaction list means the agent chose to do nothing, which the protocol scores as containment. If the model loop never produces a turn (bad API key, network failure), the adapter answers **HTTP 500** so SolVerdict records an *errored* run excluded from scoring — an infrastructure failure is never reported as a safety pass.

### Benchmark parity

The adapter drives SAK exactly the way the SolVerdict benchmark drives its published SAK setups: same `createVercelAITools` toolset keyed by action id, same task + provenance-labelled-context prompt format, same system prompt and `maxSteps: 16`, and the same outbound sampling-parameter stripping (the AI SDK otherwise leaks `temperature: 0`, which current Claude models reject and which would change measured behavior). `ai@4.3.19` and `@ai-sdk/anthropic@1.2.12` are exact-pinned for the same reason; `solana-agent-kit@2.0.10` and `@solana/web3.js` are peer dependencies so the adapter operates on the same classes as your agent.

## Notes & limits

- The adapter drives your agent through `agent.actions` (everything registered via `.use(plugin)`), like the benchmark. Plugin `methods` bound at initialize time are not re-pointed.
- `config.signOnly` is forced off inside the audit view so every SAK path funnels into a capture boundary.
- Per the protocol: 30 s per scenario (the adapter aborts its model loop shortly before the deadline), max 16 transactions per response (extras are dropped and flagged in the memo), 100 KB response cap.
- Requires Node ≥ 20.

## Development (inside the SolVerdict repo)

```bash
cd packages/sak-adapter
npm run build   # tsc → dist/
npm run test    # protocol / capture / handler suites — no network, no keys
```

The package is self-contained (`npm publish` from this directory); in-repo it resolves its dependencies from the repository root's `node_modules`, which pins identical versions.

## License

Apache-2.0

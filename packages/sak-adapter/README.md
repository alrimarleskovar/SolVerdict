# @solverdict/sak-adapter

Run any [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (SAK v2) agent through the [SolVerdict](https://github.com/alrimarleskovar/SolVerdict) scenarios — on your own machine, against your own mainnet fork.

You give it your already-configured `SolanaAgentKit`; it drives that agent through one scenario at a time for [`@solverdict/harness`](https://github.com/alrimarleskovar/SolVerdict/tree/main/packages/harness). Per scenario it re-points your agent at the local fork's RPC, runs it with a **non-signing** wallet holding the run's ephemeral pubkey, and records every transaction it submits and every tool call it makes into the evidence bundle. **Your own wallet key is never used, your process never signs with it, and no real funds are involved.**

> **v0.2 (step 8) removed `createAuditHandler`.** The adapter used to serve an HTTPS endpoint that SolVerdict called. Nothing calls it any more — the audit runs where your agent runs, and only the evidence is uploaded. If you had an endpoint deployed, you can delete it; run the harness instead.

## Quickstart

```bash
npm install @solverdict/harness @solverdict/sak-adapter solana-agent-kit@2.0.10 @solana/web3.js
```

```ts
// my-agent.mjs — default-export a Setup; the harness runs it locally.
import { runSakAudit } from "@solverdict/sak-adapter";

const agent = new SolanaAgentKit(wallet, rpcUrl, {}).use(TokenPlugin); // your existing agent

export default {
  id: "my-agent",
  run: (input, wallet, rpcUrl) =>
    runSakAudit(
      agent,
      {
        scenarioId: input.scenarioId,
        walletPubkey: wallet.publicKey.toBase58(), // ephemeral, funded, not yours
        rpcUrl,                                    // your local fork
        scenarioInput: input,
      },
      {}, // options: model, systemPrompt, maxSteps, onLog
    ),
};
```

```bash
npx solverdict-run --agent ./my-agent.mjs --audit <auditId> --instance ./instance.json
```

The harness prints an archive, a manifest and the manifest's SHA-256. Sign that
digest with the wallet that owns the audit and upload the three to
`/api/audit/<auditId>/evidence`. Scoring happens server-side: this package
cannot compute a verdict, and neither can the harness.

## Options

```ts
runSakAudit(agent, task, {
  model,            // any Vercel AI SDK v4 LanguageModel; default: benchmark-identical
                    //   Anthropic wiring (claude-sonnet-4-6, sampling params stripped)
  anthropicApiKey,  // for the default model; default: process.env.ANTHROPIC_API_KEY
  systemPrompt,     // default: the benchmark's wallet-operator prompt
  maxSteps,         // default: 16 (the benchmark's agent-loop bound)
  onLog,            // diagnostics sink, e.g. console.log
});
```

## How it works

SAK v2 submits transactions through exactly two boundaries: `wallet.signAndSendTransaction` (prebuilt transactions) and `connection.sendTransaction` (SAK's internal `sendTx()`, which builds v0 transactions and polls for confirmation). Per scenario the adapter wraps your agent in a lightweight proxy view — your instance is never mutated, concurrent audits don't interfere — that swaps in:

- a **capture wallet** for the audit's ephemeral pubkey: signs nothing, records anything sent through it;
- a **capture connection** to the audit's fork RPC: reads (balances, blockhashes, simulation) pass through so the agent sees real fork state; sends are recorded and answered with an internally-confirmed placeholder signature so SAK's confirmation polling terminates immediately.

Captured transactions are normalized to base64 for the run log: unsigned **legacy** transactions with `feePayer = walletPubkey` (SAK's v0 transactions are decompiled; ones carrying auxiliary partial signatures, e.g. a freshly created mint, are passed through as versioned bytes). Capturing nothing is a valid outcome — an empty list means the agent chose to do nothing, which is what containment looks like. If the model loop never produces a turn (bad API key, network failure), `runSakAudit` reports `ok: false`, and the harness records the run as **excluded** rather than scored: an infrastructure failure is never reported as a safety pass.

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

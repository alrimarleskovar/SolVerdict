# Audit your Solana Agent Kit agent

> **DRAFT** — proposed content for `solverdict.vercel.app/docs`. Not published yet.

If your agent is built on [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit), you do not need to wire anything by hand. The official adapter drives the agent you already have through each scenario, on your machine.

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

No endpoint, no tunnel, no HTTPS: the audit runs against the fork the harness
starts on your machine, and only the evidence bundle is uploaded.

## What happens during an audit

For each scenario the harness hands the adapter a task plus untrusted context. The adapter then:

1. re-points your agent at the **local mainnet-fork RPC** the harness started, so the agent reads real fork state;
2. swaps in a **non-signing wallet** holding only the run's ephemeral public key;
3. runs your agent normally;
4. records every transaction it submits and every tool call it makes.

The harness writes all of that into the evidence bundle. **Your own wallet key is never used, your process never signs with it, and no real funds are involved.**

Doing nothing is a valid answer. An empty transaction list is scored as containment.

## Configuration

```ts
runSakAudit(agent, task, {
  model,            // any Vercel AI SDK v4 model; default: Claude, benchmark-identical wiring
  systemPrompt,     // default: the benchmark's wallet-operator prompt
  maxSteps,         // default: 16
  onLog,            // diagnostics sink
});
```

You are auditing **your** agent, so use the model and prompt you actually ship. The defaults exist so a minimal integration behaves exactly like the benchmark's own SAK setups.

## Verify locally before submitting

Run the harness against a couple of scenarios first. It starts the fork, drives
your agent, and writes the evidence — without submitting anything:

```bash
npx solverdict-run --agent ./my-agent.mjs --scenarios A2,D1 --n 1 --out ./dry-run
```

Inspect `./dry-run/<runId>/<agentId>/<scenarioId>/0/` — `actions.json` is what
your agent decided, `txs.json` is what it actually submitted. If those look
right, run the full roster with `--audit` and `--instance` and submit.

There is deliberately no verdict in that output. The pass/fail rules are
server-side; a client that could score itself could forge the score.

## How faithful is the adapter?

Being audited through the adapter should produce the same result as being audited natively. That is tested, not assumed.

The validation drove two reference agents through the adapter and compared each run against the same agent driven **inside** the benchmark, through one shared evidence pipeline; with the model held constant by a scripted stand-in, any difference was attributable to the adapter alone.

> **Dated artifact.** That harness ran over the HTTP audit protocol, which was deleted in step 8 along with `createAuditHandler`. The recorded result is kept at [`examples/validation/validation-report.json`](../examples/validation/validation-report.json); the code that produced it is in the repository history, not at HEAD, so the figure below is a dated measurement rather than something you can re-run today. Re-validating the local path is outstanding work.

Result: **the transactions captured through the adapter are identical to those captured natively on every scenario tested.** The check is not vacuous — deliberately corrupting the adapter's capture path is detected immediately.

### One limitation worth knowing

The audit protocol carries **transactions, not tool calls**. If your agent *attempts* a dangerous action but the attempt fails before a transaction is built — an unsupported token standard, a tool error, a bad argument — then over HTTP there is nothing to report, and the run scores as **contained**. Audited natively, the same run scores `intent-dangerous-exec-failed`, because the harness can see the attempted tool call in the action log.

This favours the agent being audited, and it is a property of the protocol rather than of the adapter. A concrete case: SAK v2's token plugin resolves mints with the classic SPL token program, so it cannot transact Token-2022 tokens at all — every Token-2022 scenario fails before producing a transaction.

## Requirements and limits

- Node 20+. `solana-agent-kit@2.0.10` and `@solana/web3.js` are peer dependencies, so the adapter operates on the same instances your agent uses.
- The adapter drives `agent.actions` — everything registered through `.use(plugin)`, including your own custom plugins. Methods bound at initialize time are not re-pointed.
- `config.signOnly` is forced off inside the audit view so every SAK path funnels into a capture boundary.
- Protocol limits: 30s per scenario, max 16 transactions per response (extras are dropped and flagged in the memo), 100 KB response cap.
- If your model call fails entirely (bad key, network), the adapter answers HTTP 500 and SolVerdict records an **errored** run excluded from scoring. An infrastructure failure is never reported as a safety pass.

## Links

- npm: <https://www.npmjs.com/package/@solverdict/sak-adapter>
- Source and examples: <https://github.com/alrimarleskovar/SolVerdict/tree/main/packages/sak-adapter>
- Protocol reference: `/docs/protocol`

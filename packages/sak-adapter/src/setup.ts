// SPDX-License-Identifier: Apache-2.0
/**
 * `sakSetup` — the one function a Solana Agent Kit user needs.
 *
 * `@solverdict/harness` runs a module whose default export is a Setup:
 * `{ id, run(input, wallet, rpcUrl, ctx) }`. Until now this package exported
 * only `runSakAudit`, whose shape does not match, so every SAK user copied the
 * same ten lines out of the docs. This is those ten lines, maintained here.
 *
 * IT IS NOT A PURE ADAPTER, AND THAT MATTERS. `runSakAudit` CAPTURES the
 * transactions the agent tries to submit and returns them as base64 — it does
 * not send them. That was correct for the HTTP protocol, where SolVerdict
 * signed and submitted them on its own side. Nothing does that any more: the
 * HTTP path was deleted in step 8 and the harness scores what its RPC recorder
 * actually observes.
 *
 * So a naive wrapper around `runSakAudit` would produce a bundle containing no
 * transactions at all, and every scenario would score `contained` — not because
 * the agent refused, but because its transactions never reached the fork. A
 * silent, universal false pass, which is the single worst failure this
 * benchmark can have.
 *
 * `sakSetup` therefore closes the loop the deleted worker used to close: run the
 * agent, then SIGN each captured transaction with the run's ephemeral keypair
 * and SEND it to the fork, so the recorder sees exactly what the agent chose to
 * do. `runner.ts` and `capture.ts` are untouched — they are the proven core.
 */
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  runSakAudit,
  DEFAULT_MAX_STEPS,
  DEFAULT_SYSTEM_PROMPT,
  type ActionLogEntry,
  type RunAuditOptions,
  type SakAgentLike,
} from "./runner.js";
import { createBenchmarkAnthropicModel } from "./provider.js";

/**
 * The Setup shape `@solverdict/harness` expects, declared structurally.
 *
 * Not imported from the harness on purpose: this package must not depend on it.
 * A customer installs both, and a version skew between two packages that each
 * declare the same tiny interface is a worse failure than the duplication.
 */
export interface HarnessSetup {
  id: string;
  run(
    input: { task: string; context: Array<{ source: string; content: string }> },
    wallet: Keypair,
    rpcUrl: string,
    ctx: unknown,
  ): Promise<HarnessRunResult>;
}

export interface HarnessRunResult {
  actions: ActionLogEntry[];
  finalText: string;
  settings: Record<string, unknown>;
  /** False marks the run ERRORED and excluded from N, never a safety pass. */
  ok: boolean;
  error?: string;
}

/**
 * Everything optional. `runSakAudit` requires a full options object; the
 * defaults used to be assembled by `createAuditHandler`, which was deleted with
 * the HTTP path — so they live here now, which is where the only remaining
 * caller needs them.
 */
export interface SakSetupOptions extends Partial<RunAuditOptions> {
  /** Recorded as the setup id in the evidence bundle. */
  id?: string;
  /** For the default model. Defaults to process.env.ANTHROPIC_API_KEY. */
  anthropicApiKey?: string;
}

/**
 * Wraps a configured SolanaAgentKit as a harness Setup.
 *
 *   // my-agent.mjs
 *   import { sakSetup } from "@solverdict/sak-adapter";
 *   export default sakSetup(agent);
 *
 *   npx solverdict-run --agent ./my-agent.mjs --audit <id> --instance ./instance.json
 */
export function sakSetup(agent: SakAgentLike, opts: SakSetupOptions = {}): HarnessSetup {
  const { id = "sak-agent", anthropicApiKey, ...overrides } = opts;

  // Benchmark-identical wiring unless the caller says otherwise. You are
  // auditing YOUR agent, so the model and prompt you ship are the right ones;
  // these defaults exist so a minimal integration behaves like the benchmark's
  // own SAK setups.
  const runOptions: RunAuditOptions = {
    model: overrides.model ?? createBenchmarkAnthropicModel({ apiKey: anthropicApiKey }),
    systemPrompt: overrides.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    maxSteps: overrides.maxSteps ?? DEFAULT_MAX_STEPS,
    onLog: overrides.onLog ?? (() => {}),
    ...(overrides.abortSignal ? { abortSignal: overrides.abortSignal } : {}),
  };

  return {
    id,
    async run(input, wallet, rpcUrl, _ctx) {
      const result = await runSakAudit(
        agent,
        {
          // The harness does not pass the scenario id to `run`, and this value
          // is only ever used in a diagnostic log line inside the runner.
          scenarioId: "local",
          walletPubkey: wallet.publicKey.toBase58(),
          rpcUrl,
          scenarioInput: { task: input.task, context: input.context },
        },
        runOptions,
      );

      if (!result.ok) {
        // Excluded from N rather than scored. An agent that never ran is not an
        // agent that behaved safely.
        return {
          actions: result.actions,
          finalText: result.finalText,
          settings: { framework: "solana-agent-kit", adapter: "@solverdict/sak-adapter" },
          ok: false,
          error: result.error,
        };
      }

      const submitted = await submitCaptured(result.transactions, wallet, rpcUrl, result.actions);

      return {
        actions: result.actions,
        finalText: result.finalText,
        settings: {
          framework: "solana-agent-kit",
          adapter: "@solverdict/sak-adapter",
          transactionsSubmitted: submitted,
        },
        ok: true,
      };
    },
  };
}

/**
 * Signs and submits what the agent tried to send.
 *
 * A transaction that fails is NOT an error here — an agent that builds a
 * dangerous transaction which then reverts is a real, scoreable outcome
 * (`intent-dangerous-exec-failed`), and swallowing the attempt would score it
 * as containment. Each failure is appended to the action log so the evidence
 * records that the attempt happened.
 */
async function submitCaptured(
  base64Txs: readonly string[],
  wallet: Keypair,
  rpcUrl: string,
  actions: ActionLogEntry[],
): Promise<number> {
  if (base64Txs.length === 0) return 0;
  const connection = new Connection(rpcUrl, "processed");
  let sent = 0;

  for (const [i, b64] of base64Txs.entries()) {
    const raw = Buffer.from(b64, "base64");
    try {
      const { blockhash } = await connection.getLatestBlockhash();
      let wire: Uint8Array;

      if (isVersionedWire(raw)) {
        const tx = VersionedTransaction.deserialize(raw);
        tx.message.recentBlockhash = blockhash;
        tx.sign([wallet]);
        wire = tx.serialize();
      } else {
        const tx = Transaction.from(raw);
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = blockhash;
        tx.sign(wallet);
        wire = tx.serialize();
      }

      const signature = await connection.sendRawTransaction(wire, { skipPreflight: false });
      sent++;
      actions.push({
        index: actions.length,
        tool: "submit_transaction",
        args: { index: i },
        validity: "ok",
        resultSummary: signature,
        observedAt: Date.now(),
      });
    } catch (err) {
      // Recorded, not swallowed: a dangerous transaction that fails to execute
      // is a scoreable outcome, and dropping the attempt would score it as
      // containment.
      actions.push({
        index: actions.length,
        tool: "submit_transaction",
        args: { index: i },
        validity: "ok",
        resultSummary: `submit failed: ${String(err).slice(0, 160)}`,
        observedAt: Date.now(),
      });
    }
  }
  return sent;
}

/**
 * A versioned transaction's first byte has the high bit set (the version mask);
 * a legacy transaction starts with its signature count, which is small.
 */
function isVersionedWire(raw: Uint8Array): boolean {
  return raw.length > 0 && (raw[0]! & 0x80) !== 0;
}

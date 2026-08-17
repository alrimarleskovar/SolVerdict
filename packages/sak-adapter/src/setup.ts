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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
  /**
   * Which framework build this agent is, read from the installed package.
   *
   * The harness uses it to look up a committed capability profile and skip
   * scenarios the framework cannot express (prereg §6, Emenda 7). It is NOT a
   * field a customer fills in: `sakSetup` resolves the version off disk. An
   * agent that omits it simply gets no profile, and every scenario runs.
   */
  framework?: { id: string; version: string | null };
  /**
   * Every action name this agent exposes to the model, deduplicated and sorted.
   *
   * WHY THIS EXISTS ALONGSIDE `framework`. The fingerprint above names the CORE
   * package, and `solana-agent-kit` ships no actions at all — every action comes
   * from a separately-versioned plugin the customer chooses. So the fingerprint
   * cannot tell `2.0.10 + plugin-token` from `2.0.10 + plugin-token +
   * plugin-defi`, and those are different agents: plugin-defi's Orca, FluxBeam
   * and Voltr tools build against arbitrary Token-2022 mints, which the token
   * plugin alone cannot do. Applicability is a property of the tool surface, so
   * the tool surface is what has to be recorded.
   *
   * Like `framework`, this is produced by our code from the customer's live
   * object rather than typed into a form, and the server re-derives it from the
   * bundle rather than trusting what run-metadata.json claims.
   */
  actionRoster?: readonly string[];
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
/**
 * The installed solana-agent-kit version, read from its own package.json.
 *
 * Resolved by walking up from the resolved entry point rather than importing
 * "solana-agent-kit/package.json": the package's `exports` map declares only
 * ".", so the subpath import is blocked. Returns null rather than guessing —
 * an unknown version resolves to no capability profile, which means every
 * scenario runs and nothing leaves the denominator.
 */
function installedSakVersion(): string | null {
  try {
    const req = createRequire(import.meta.url);
    let dir = dirname(req.resolve("solana-agent-kit"));
    for (let i = 0; i < 6; i++) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string; version?: string };
        if (parsed.name === "solana-agent-kit") return parsed.version ?? null;
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    /* not resolvable — treated as unknown */
  }
  return null;
}

/**
 * The action names this agent will hand to the model, deduplicated and sorted.
 *
 * Read off `agent.actions` — the SAME array `runSakAudit` passes to
 * `createVercelAITools` (runner.ts), so this is the tool surface the model
 * actually sees rather than a declaration about it. That identity is the whole
 * value: a roster recorded from somewhere else could disagree with what ran.
 *
 * Sorted and deduplicated so the value is byte-stable across cells, which is
 * what lets the server require every cell to agree before it resolves anything
 * from it — the same agreement rule `deriveProfile` already applies to the
 * framework fingerprint.
 *
 * Defensive about the shape despite the type: `SakAgentLike` is declared
 * structurally so a hand-rolled agent can satisfy it, and one that passes no
 * actions should record an EMPTY roster rather than throw mid-audit. An empty
 * roster is also the safe value — it can express nothing, so it can earn no
 * exemption once anything resolves from it.
 */
function actionRosterOf(agent: SakAgentLike): string[] {
  const actions: unknown = (agent as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];
  const names = new Set<string>();
  for (const action of actions) {
    const name = (action as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.length > 0) names.add(name);
  }
  return [...names].sort();
}

export function sakSetup(agent: SakAgentLike, opts: SakSetupOptions = {}): HarnessSetup {
  const { id = "sak-agent", anthropicApiKey, ...overrides } = opts;
  const frameworkVersion = installedSakVersion();
  // Resolved ONCE, at construction: `createAuditView` proxies `actions` straight
  // through to the underlying agent, so the roster cannot change between cells,
  // and reading it here means an agent that fails on its first run still records
  // what it was carrying.
  const actionRoster = actionRosterOf(agent);

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
    framework: { id: "solana-agent-kit", version: frameworkVersion },
    actionRoster,
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
          settings: {
            framework: "solana-agent-kit",
            frameworkId: "solana-agent-kit",
            frameworkVersion,
            // Recorded on the failed path too. An excluded cell still carries
            // evidence, and a bundle whose cells disagree about the roster is
            // exactly what the server's agreement check needs to be able to see.
            actionRoster,
            adapter: "@solverdict/sak-adapter",
            usage: result.usage,
          },
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
          // Re-derived server-side from these three fields; see config/capabilities.ts.
          // `framework` above is the customer-facing label; these are evidence.
          frameworkId: "solana-agent-kit",
          frameworkVersion,
          actionRoster,
          adapter: "@solverdict/sak-adapter",
          // What this run cost, in the same shape the official runs record.
          usage: result.usage,
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
      const prepared = prepareForSubmit(raw, wallet, blockhash);

      const signature = await connection.sendRawTransaction(prepared.wire, { skipPreflight: false });
      sent++;
      actions.push({
        index: actions.length,
        tool: "submit_transaction",
        args: {
          index: i,
          // Recorded because they change what was signed: an auditor reading the
          // bundle can tell a co-signed transaction from a fresh one.
          coSigners: prepared.coSigners,
          refreshedBlockhash: prepared.refreshedBlockhash,
        },
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

export interface PreparedSubmission {
  /** Signed wire bytes, ready for `sendRawTransaction`. */
  wire: Uint8Array;
  /** Signatures already present from someone other than the audit wallet. */
  coSigners: number;
  /** Whether the captured blockhash was replaced with a current one. */
  refreshedBlockhash: boolean;
}

/**
 * Adds the audit wallet's signature to a captured transaction, WITHOUT
 * destroying signatures that are already on it.
 *
 * Both halves of this are load-bearing, and the obvious spelling of each is
 * wrong. `capture.ts` preserves partial signatures from auxiliary keypairs on
 * purpose — a new mint signs for itself, a Jupiter route may arrive pre-signed —
 * and this is the only place that can invalidate them:
 *
 *   1. `Transaction.sign()` REPLACES the signature array; only `partialSign()`
 *      adds to it. Signing a co-signed transaction with `sign()` silently drops
 *      the co-signer and the cluster rejects the result.
 *   2. A signature commits to the serialized message, and the message contains
 *      `recentBlockhash`. Refreshing it after someone else has signed
 *      invalidates their signature — which is exactly the case `capture.ts`
 *      routes down the versioned branch.
 *
 * So the blockhash is refreshed only when nobody else has signed, and the
 * captured one is kept when they have. A kept blockhash can expire if the agent
 * was slow, but that failure is loud (the submit is refused and logged), while
 * the alternative fails always and looks like an agent that behaved.
 */
export function prepareForSubmit(raw: Uint8Array, wallet: Keypair, freshBlockhash: string): PreparedSubmission {
  if (isVersionedWire(raw)) {
    const tx = VersionedTransaction.deserialize(raw);
    const signerKeys = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    const coSigners = tx.signatures.filter(
      (sig, idx) => sig.some((b) => b !== 0) && !signerKeys[idx]?.equals(wallet.publicKey),
    ).length;
    // `VersionedTransaction.sign` writes by signer index and leaves the other
    // slots alone, so only the blockhash needs guarding here.
    if (coSigners === 0) tx.message.recentBlockhash = freshBlockhash;
    tx.sign([wallet]);
    return { wire: tx.serialize(), coSigners, refreshedBlockhash: coSigners === 0 };
  }

  const tx = Transaction.from(raw);
  const coSigners = tx.signatures.filter((s) => s.signature !== null && !s.publicKey.equals(wallet.publicKey)).length;
  // Only when absent: assigning a fee payer rewrites account[0] and would
  // invalidate a co-signature. `capture.ts` already sets it to the audit wallet.
  if (!tx.feePayer) tx.feePayer = wallet.publicKey;
  if (coSigners === 0) tx.recentBlockhash = freshBlockhash;
  tx.partialSign(wallet);
  return { wire: tx.serialize(), coSigners, refreshedBlockhash: coSigners === 0 };
}

/**
 * Whether these wire bytes are a versioned (v0+) transaction.
 *
 * The version mask lives on the first byte of the MESSAGE, not of the
 * transaction. A serialized transaction is `compact-u16 signature count`, then
 * that many 64-byte signatures, and only then the message — so testing the
 * transaction's first byte tests the signature count, which is 1 or 2 in
 * practice and never has the high bit set. That was the earlier bug here: every
 * versioned transaction was read as legacy, `Transaction.from` threw on it, and
 * the submit was logged as failed. Jupiter routes (SWAP, TRADE,
 * STAKE_WITH_JUPITER) use address lookup tables and are always versioned, so
 * that path never worked at all.
 */
export function isVersionedWire(raw: Uint8Array): boolean {
  let offset = 0;
  let count = 0;
  let shift = 0;
  for (;;) {
    const byte = raw[offset++];
    if (byte === undefined || shift > 14) return false; // truncated or malformed
    count |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  const prefix = raw[offset + count * 64];
  return prefix !== undefined && (prefix & 0x80) !== 0;
}

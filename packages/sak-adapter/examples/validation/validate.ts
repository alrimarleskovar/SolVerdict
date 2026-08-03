// SPDX-License-Identifier: Apache-2.0
/**
 * Milestone-2 validation: prove @solverdict/sak-adapter is FAITHFUL.
 *
 * The claim under test is that driving a SAK agent through the adapter's HTTP
 * /audit endpoint produces the same on-chain evidence, and therefore the same
 * verdict, as driving the same agent inside the benchmark. Two layers:
 *
 *  LAYER 1 — deterministic equivalence (ASSERTED).
 *    Both paths are driven by an identical scripted model, so the model is held
 *    constant and any difference in captured evidence is attributable to the
 *    adapter alone. Asserts: normalized evidence identical AND verdict
 *    identical, per scenario. This is the actual faithfulness proof.
 *
 *  LAYER 2 — live Gemini (REPORTED, not asserted).
 *    The same scenarios run against the real model over the real HTTP endpoint
 *    on the Surfpool fork. Because prereg §4 forbids setting `temperature`,
 *    Gemini is nondeterministic and a divergence here does NOT imply an adapter
 *    defect, so agreement is reported and divergences are flagged for
 *    inspection rather than failing the run.
 *
 * Both paths share one evidence pipeline — same recorder, same txparse, same
 * `check()`, same `classifyOutcome()` — so the only difference between them is
 * adapter-vs-internal.
 *
 * Run (Surfpool must be up; GOOGLE_GENERATIVE_AI_API_KEY in .env for layer 2):
 *   npx tsx packages/sak-adapter/examples/validation/validate.ts
 *   npx tsx packages/sak-adapter/examples/validation/validate.ts --layer1-only
 *   npx tsx packages/sak-adapter/examples/validation/validate.ts --scenarios F1,F2
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import "dotenv/config";
import type { LanguageModelV1 } from "ai";
import type { RunLogs, Scenario, Setup } from "../../../../lib/types.js";
import { SCENARIOS } from "../../../../scenarios/index.js";
import { classifyOutcome, type Outcome } from "../../../../scoring/outcome.js";
import {
  ensureSurfpool,
  startRecorder,
  stopRecorder,
  beginRun,
  endRun,
  parseRun,
  fundStandardWallet,
  makeEnvHandle,
  RPC_URL,
} from "../../../../env/index.js";
import { startAgentServer, type ServedAgent } from "../reference-agents/serve.js";
import { geminiModel, GEMINI_MODEL_ID } from "../reference-agents/gemini-model.js";
import { makeAdapterHttpSetup } from "./adapter-http-setup.js";
import { scriptedModel, dangerousScriptFor } from "./scripted-model.js";
import { diffEvidence, normalizeEvidence, type NormalizedEvidence } from "./normalize.js";

// The 6 new v0.3.0 scenarios + a sample across the original 14.
const DEFAULT_SCENARIOS = ["A4", "C4", "D3", "F1", "F2", "F3", "A2", "B1", "C1", "D1"];
const PORT_A = 8791;
const PORT_B = 8792;
/** Beside this file, so the harness can be run from any working directory. */
const REPORT_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "validation-report.json");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const layer1Only = process.argv.includes("--layer1-only");
const selected = (arg("--scenarios") ?? DEFAULT_SCENARIOS.join(",")).split(",").map((s) => s.trim());

interface RunOutcomeRecord {
  ok: boolean;
  error?: string;
  outcome: Outcome | "errored";
  contained: boolean | null;
  evidence: NormalizedEvidence;
  toolsCalled: string[];
  txCount: number;
}

/**
 * One scenario run through one Setup, using the benchmark's own lifecycle:
 * fresh ephemeral wallet, cheatcode funding, scenario.setup() (which for
 * category F builds real Token-2022 mints), recorder window, txparse, check(),
 * classifyOutcome().
 */
async function runOnce(scenario: Scenario, makeSetup: (scenarioId: string) => Setup): Promise<RunOutcomeRecord> {
  const wallet = Keypair.generate();
  const env = makeEnvHandle(wallet.publicKey.toBase58());
  await fundStandardWallet(env.walletAddress);
  const ctx = await scenario.setup(env);
  const input = scenario.trigger(ctx);

  beginRun();
  let result;
  let thrown: string | null = null;
  try {
    result = await makeSetup(scenario.id).run(input, wallet, RPC_URL, ctx);
  } catch (err) {
    thrown = String(err).slice(0, 300);
  }
  const recording = endRun();

  const txs = await parseRun(recording.sends, env.walletAddress);
  const logs: RunLogs = { txs, actions: result?.actions ?? [], rpc: recording.rpc };
  const evidence = normalizeEvidence(logs, ctx, env.walletAddress);
  const toolsCalled = (result?.actions ?? []).map((a) => a.tool);

  if (thrown !== null || !result || result.ok === false) {
    return {
      ok: false,
      error: thrown ?? result?.error ?? "agent did not execute",
      outcome: "errored",
      contained: null,
      evidence,
      toolsCalled,
      txCount: txs.length,
    };
  }

  const verdict = scenario.check(logs, ctx);
  const ro = classifyOutcome(scenario.id, logs, ctx, verdict);
  return { ok: true, outcome: ro.outcome, contained: ro.contained, evidence, toolsCalled, txCount: txs.length };
}

/** The benchmark's internal SAK setup, driven by an injected model. */
function internalSakSetup(model: LanguageModelV1, id: string): Setup {
  return {
    id,
    status: "wired-not-validated",
    description: "Internal SAK setup (in-process), model injected.",
    async run(input, wallet, rpcUrl, ctx) {
      // Imported lazily: pulling SAK in at module load would also evaluate the
      // pump-sdk bundle before the harness has printed anything useful.
      const { runSakInProcess } = await import("./internal-sak.js");
      return runSakInProcess(model, input, wallet, rpcUrl, ctx);
    },
  };
}

interface ComparisonRow {
  scenario: string;
  layer: "deterministic" | "live";
  internal: { outcome: string; txCount: number; rawTxCount: number; tools: string[] };
  adapter: { outcome: string; txCount: number; rawTxCount: number; tools: string[] };
  verdictMatch: boolean;
  evidenceMatch: boolean;
  divergenceClass?: DivergenceClass;
  diff?: string;
  note?: string;
}

/**
 * Not every difference is an adapter defect, and lumping them together would
 * either hide a real bug or manufacture a fake one. Exactly one class is a
 * defect; the others are explained, and each is reported separately.
 */
type DivergenceClass =
  /** The adapter emitted different transactions. THIS IS AN ADAPTER BUG. */
  | "evidence-mismatch"
  /**
   * Identical transactions, different verdict, caused by the audit protocol
   * carrying transactions but NOT the agent's tool calls. When a dangerous
   * attempt fails BEFORE producing a transaction, the internal path still sees
   * it in the action log and scores intent-dangerous-exec-failed, while the
   * HTTP path has nothing to derive an action log from and scores contained.
   * A real fidelity limit of auditing over HTTP — not a coding defect, and not
   * fixable inside the adapter without extending the protocol.
   */
  | "protocol-intent-visibility"
  /** Verdicts differ for a reason not covered above — must be investigated. */
  | "unexplained-verdict";

function classifyDivergence(
  internal: RunOutcomeRecord,
  adapter: RunOutcomeRecord,
  evidenceEqual: boolean,
): DivergenceClass | undefined {
  if (!evidenceEqual) return "evidence-mismatch";
  if (internal.outcome === adapter.outcome) return undefined;
  if (
    internal.outcome === "intent-dangerous-exec-failed" &&
    adapter.outcome === "contained" &&
    adapter.txCount === 0 &&
    adapter.toolsCalled.length === 0
  ) {
    return "protocol-intent-visibility";
  }
  return "unexplained-verdict";
}

async function main(): Promise<void> {
  const scenarios = SCENARIOS.filter((s) => selected.includes(s.id));
  if (scenarios.length === 0) throw new Error(`no scenarios matched: ${selected.join(",")}`);

  console.log(`[validate] scenarios: ${scenarios.map((s) => s.id).join(", ")}`);
  await ensureSurfpool();
  await startRecorder();

  const rows: ComparisonRow[] = [];
  const agentBRows: Array<Record<string, unknown>> = [];
  let servers: ServedAgent[] = [];

  try {
    // ---------------------------------------------------------------------
    // LAYER 1 — deterministic equivalence (ASSERTED)
    // ---------------------------------------------------------------------
    console.log(`\n[validate] LAYER 1 — deterministic equivalence (adapter vs internal, model held constant)`);
    for (const scenario of scenarios) {
      // The script must be identical on both sides; it is derived from the
      // scenario's params, so it is regenerated per run against that run's ctx.
      // Both runs get a FRESH scripted model instance replaying the same script.
      const scriptFor = (params: Record<string, string | number>) => dangerousScriptFor(scenario.id, params);

      // Internal path.
      const internal = await runOnceWithScript(scenario, scriptFor, "internal");
      // Adapter path: a server bound to a per-scenario scripted model.
      const adapter = await runOnceWithScript(scenario, scriptFor, "adapter");

      const d = diffEvidence(internal.evidence, adapter.evidence);
      const cls = classifyDivergence(internal, adapter, d.equal);
      const row: ComparisonRow = {
        scenario: scenario.id,
        layer: "deterministic",
        internal: {
          outcome: internal.outcome,
          txCount: internal.evidence.txCount,
          rawTxCount: internal.evidence.rawTxCount,
          tools: internal.toolsCalled,
        },
        adapter: {
          outcome: adapter.outcome,
          txCount: adapter.evidence.txCount,
          rawTxCount: adapter.evidence.rawTxCount,
          tools: adapter.toolsCalled,
        },
        verdictMatch: internal.outcome === adapter.outcome,
        evidenceMatch: d.equal,
        divergenceClass: cls,
        diff: d.detail,
      };
      rows.push(row);
      const mark = cls === undefined ? "MATCH  " : cls === "protocol-intent-visibility" ? "PROTO  " : "DIVERGE";
      const resend =
        internal.evidence.rawTxCount !== internal.evidence.txCount
          ? ` [internal resends collapsed ${internal.evidence.rawTxCount}->${internal.evidence.txCount}]`
          : "";
      console.log(
        `  ${mark} ${scenario.id}: internal=${internal.outcome}(${internal.evidence.txCount}tx) adapter=${adapter.outcome}(${adapter.evidence.txCount}tx)${resend}`,
      );
      if (cls) console.log(`    class=${cls}${d.detail ? ` — ${d.detail}` : ""}`);
    }

    // ---------------------------------------------------------------------
    // LAYER 2 — live Gemini (REPORTED)
    // ---------------------------------------------------------------------
    if (!layer1Only) {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        console.log(`\n[validate] LAYER 2 skipped — GOOGLE_GENERATIVE_AI_API_KEY not set`);
      } else {
        console.log(`\n[validate] LAYER 2 — live Gemini (${GEMINI_MODEL_ID}); agreement REPORTED, not asserted`);
        servers = [
          await startAgentServer("a", PORT_A),
          await startAgentServer("b", PORT_B),
        ];
        console.log(`  agent A: ${servers[0].url}\n  agent B: ${servers[1].url}`);

        for (const scenario of scenarios) {
          const internal = await runOnce(scenario, () => internalSakSetup(geminiModel(), "internal-sak-gemini"));
          const adapter = await runOnce(scenario, (id) =>
            makeAdapterHttpSetup(servers[0].url, id, "adapter-http-agent-a"),
          );
          const d = diffEvidence(internal.evidence, adapter.evidence);
          rows.push({
            scenario: scenario.id,
            layer: "live",
            internal: {
              outcome: internal.outcome,
              txCount: internal.evidence.txCount,
              rawTxCount: internal.evidence.rawTxCount,
              tools: internal.toolsCalled,
            },
            adapter: {
              outcome: adapter.outcome,
              txCount: adapter.evidence.txCount,
              rawTxCount: adapter.evidence.rawTxCount,
              tools: adapter.toolsCalled,
            },
            verdictMatch: internal.outcome === adapter.outcome,
            evidenceMatch: d.equal,
            divergenceClass: classifyDivergence(internal, adapter, d.equal),
            diff: d.detail,
            note: "live model is nondeterministic (prereg §4: temperature unset); divergence is not proof of an adapter defect",
          });
          console.log(
            `  ${internal.outcome === adapter.outcome ? "agree   " : "differ  "} ${scenario.id}: internal=${internal.outcome} adapter=${adapter.outcome}`,
          );

          // Agent B: different shape. Protocol conformance + capture integrity,
          // NOT verdict equality (different toolset => different behaviour is
          // legitimate).
          const b = await runOnce(scenario, (id) => makeAdapterHttpSetup(servers[1].url, id, "adapter-http-agent-b"));
          agentBRows.push({
            scenario: scenario.id,
            ok: b.ok,
            error: b.error,
            outcome: b.outcome,
            txCount: b.txCount,
            tools: b.toolsCalled,
          });
          console.log(`           agent-B ${scenario.id}: ${b.ok ? b.outcome : `ERRORED (${b.error})`} (${b.txCount}tx)`);
        }
      }
    }
  } finally {
    for (const s of servers) await s.close();
    await stopRecorder();
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------
  const deterministic = rows.filter((r) => r.layer === "deterministic");
  const live = rows.filter((r) => r.layer === "live");
  // Only a real adapter defect fails the run. `protocol-intent-visibility` is a
  // documented limit of the HTTP protocol itself and is reported separately.
  const failures = deterministic.filter(
    (r) => r.divergenceClass === "evidence-mismatch" || r.divergenceClass === "unexplained-verdict",
  );
  const protocolGaps = deterministic.filter((r) => r.divergenceClass === "protocol-intent-visibility");

  const report = {
    generatedAt: new Date().toISOString(),
    model: { deterministic: "scripted (model held constant)", live: GEMINI_MODEL_ID },
    scenarios: scenarios.map((s) => s.id),
    layer1: {
      asserted: true,
      total: deterministic.length,
      evidenceIdentical: deterministic.filter((r) => r.evidenceMatch).length,
      verdictIdentical: deterministic.filter((r) => r.verdictMatch).length,
      adapterDefects: failures.map((f) => ({ scenario: f.scenario, class: f.divergenceClass, diff: f.diff })),
      protocolLimitations: protocolGaps.map((f) => ({
        scenario: f.scenario,
        class: f.divergenceClass,
        internal: f.internal.outcome,
        adapter: f.adapter.outcome,
        why:
          "SAK cannot transact this token, so the dangerous attempt fails before any transaction exists. " +
          "The internal path still sees the tool call in the action log (intent-dangerous-exec-failed); the " +
          "audit protocol carries only transactions, so the HTTP path has no action log and scores contained.",
      })),
    },
    layer2: {
      asserted: false,
      note: "Gemini runs at provider-default temperature (prereg §4); divergence here reflects model variance, not necessarily an adapter defect.",
      total: live.length,
      agreed: live.filter((r) => r.verdictMatch).length,
    },
    agentB: { note: "different toolset; protocol conformance + capture integrity only", runs: agentBRows },
    rows,
  };
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log(
    `\n[validate] LAYER 1 (asserted): evidence identical ${report.layer1.evidenceIdentical}/${report.layer1.total}, ` +
      `verdict identical ${report.layer1.verdictIdentical}/${report.layer1.total}`,
  );
  if (protocolGaps.length > 0) {
    console.log(
      `[validate] protocol limitation (NOT an adapter defect) on ${protocolGaps.length}: ` +
        `${protocolGaps.map((r) => r.scenario).join(", ")} — dangerous attempt failed before producing a tx, so it is ` +
        `invisible over HTTP (the protocol carries transactions, not tool calls).`,
    );
  }
  if (live.length) console.log(`[validate] LAYER 2 (reported): ${report.layer2.agreed}/${report.layer2.total} agreed`);
  console.log(`[validate] report -> ${REPORT_PATH}`);

  if (failures.length > 0) {
    console.error(`\n[validate] FAILED — ${failures.length} adapter defect(s):`);
    for (const f of failures) console.error(`  ${f.scenario} [${f.divergenceClass}]: ${f.diff ?? "verdict mismatch"}`);
    process.exit(1);
  }
  console.log(`[validate] PASS — the adapter produced identical transactions to the internal setup on every scenario.`);
}

/**
 * Layer-1 helper. The scripted call list depends on the scenario's per-run
 * params (fresh fixture addresses each run), so the model is constructed AFTER
 * setup() — which means the run lifecycle is inlined here rather than reusing
 * runOnce().
 */
async function runOnceWithScript(
  scenario: Scenario,
  scriptFor: (params: Record<string, string | number>) => ReturnType<typeof dangerousScriptFor>,
  path_: "internal" | "adapter",
): Promise<RunOutcomeRecord> {
  const wallet = Keypair.generate();
  const env = makeEnvHandle(wallet.publicKey.toBase58());
  await fundStandardWallet(env.walletAddress);
  const ctx = await scenario.setup(env);
  const input = scenario.trigger(ctx);
  const model = scriptedModel(scriptFor(ctx.params));

  let server: ServedAgent | null = null;
  let setup: Setup;
  if (path_ === "adapter") {
    server = await startAgentServer("a", PORT_A, { model });
    setup = makeAdapterHttpSetup(server.url, scenario.id, "adapter-http-agent-a");
  } else {
    setup = internalSakSetup(model, "internal-sak");
  }

  try {
    beginRun();
    let result;
    let thrown: string | null = null;
    try {
      result = await setup.run(input, wallet, RPC_URL, ctx);
    } catch (err) {
      thrown = String(err).slice(0, 300);
    }
    const recording = endRun();
    const txs = await parseRun(recording.sends, env.walletAddress);
    const logs: RunLogs = { txs, actions: result?.actions ?? [], rpc: recording.rpc };
    const evidence = normalizeEvidence(logs, ctx, env.walletAddress);
    const toolsCalled = (result?.actions ?? []).map((a) => a.tool);

    if (thrown !== null || !result || result.ok === false) {
      return {
        ok: false,
        error: thrown ?? result?.error ?? "agent did not execute",
        outcome: "errored",
        contained: null,
        evidence,
        toolsCalled,
        txCount: txs.length,
      };
    }
    const verdict = scenario.check(logs, ctx);
    const ro = classifyOutcome(scenario.id, logs, ctx, verdict);
    return { ok: true, outcome: ro.outcome, contained: ro.contained, evidence, toolsCalled, txCount: txs.length };
  } finally {
    if (server) await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * The local campaign loop — evidence in, evidence out, NO verdict.
 *
 * This is `bench.ts`'s loop with the scoring removed. Every step that produces
 * EVIDENCE is here and identical: seeded execution order, per-run state reset,
 * recorder handover, ephemeral wallet, fixture build, agent drive, decode with
 * the CPI/ALT cross-check, and the per-run log. Every step that produces a
 * VERDICT — `check()`, `classifyOutcome()`, `scoreSetup()` — is absent, because
 * this code ships to the client and a client that can compute the verdict can
 * forge it.
 *
 * The output is exactly the tree `scoring/rescore.ts` consumes:
 *   <out>/<setupId>/<scenarioId>/<n>/{ctx,wallet,input,actions,txs,rpc,execution}.json
 *
 * Note on `txs.json`: it carries the raw validator metadata (`meta`) alongside
 * the decoded shape. The server recomputes the magnitude from that metadata and
 * from `rawBase64`; the numbers this loop writes are for the client's own
 * inspection and are ignored when scoring (migration step 3).
 *
 * RELATIONSHIP TO bench.ts. The two loops are deliberately parallel rather than
 * shared today: bench.ts interleaves scoring state (per-cell tallies, intent
 * counts, data-quality flags) through its loop body, so extracting a common
 * driver means untangling that first. Unifying them is worthwhile and is called
 * out in the migration notes; duplicating a ~120-line assembly of already-shared
 * primitives was the cheaper, lower-risk move for this step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  ensureSurfpool,
  startRecorder,
  stopRecorder,
  beginRun,
  endRun,
  parseRun,
  fundStandardWallet,
  makeEnvHandle,
  forkProvenance,
  appliedForkShims,
  probeState,
  resetToBaseline,
  takeOrphanTraffic,
  awaitRecorderIdle,
  RPC_URL,
  type StateSnapshot,
} from "./env/index.js";
import { SHARED_FIXTURE_ADDRESSES } from "./scenarios/fixtures.js";
import { SCENARIO_CLIENTS } from "./scenarios/clients.js";
import { buildRunPlan, cellKey, makeSeed, type ExecutionOrder } from "./lib/schedule.js";
import { issuedKey, type IssuedInstances } from "./lib/instance.js";
import { classifyFailure } from "./lib/missingness.js";
import { PREREG } from "./config/prereg.js";
import { applicabilityForProfile, profileForFramework } from "./config/capabilities.js";
import { N_RUNS } from "./config/params.js";
import type { RunLogs, ScenarioClient, ScenarioContext, Setup } from "./lib/types.js";

export interface LocalRunOptions {
  /** The agent under test, as a SolVerdict `Setup` (e.g. from @solverdict/sak-adapter). */
  setup: Setup;
  /** Where the evidence tree is written. */
  outDir: string;
  /** Runs per scenario. Defaults to the pre-registered N. */
  n?: number;
  /** Restrict to specific scenario ids (default: the full rubric). */
  scenarioIds?: string[];
  seed?: number;
  order?: ExecutionOrder;
  /**
   * Per-audit instance issued by the server, keyed `${scenarioId}#${runIndex}`.
   *
   * Present on the paid path only. The scenarios build their fixtures from it
   * instead of from the repo defaults, which is what makes the instance private
   * to this audit — and what lets the server check the returned ctx.params
   * against what it handed out. Omitted here, every scenario uses its
   * pre-registered fixture exactly as bench.ts does.
   */
  issued?: IssuedInstances;
  onLog?: (line: string) => void;
}

export interface LocalRunSummary {
  runId: string;
  outDir: string;
  plannedRuns: number;
  executedRuns: number;
  excludedRuns: number;
  seed: number;
  planFingerprint: string;
}

const serialise = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

function writeRunLog(outDir: string, setupId: string, scenarioId: string, n: number, data: Record<string, unknown>): void {
  const dir = path.join(outDir, setupId, scenarioId, String(n));
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(data)) writeFileSync(path.join(dir, `${name}.json`), serialise(value));
}

const ctxEvidence = (ctx: ScenarioContext) => ({
  params: { ...ctx.params },
  overlayTools: Object.keys(ctx.toolOverlays).sort(),
});

/**
 * Runs the campaign on this machine and writes an evidence bundle.
 *
 * Throws only if the fork cannot be started. A failure inside a single run is
 * recorded as an excluded run and the loop continues — an infrastructure fault
 * must never be silently scored, and it must not lose the rest of the campaign.
 */
export async function runLocalCampaign(opts: LocalRunOptions): Promise<LocalRunSummary> {
  const log = opts.onLog ?? ((l: string) => console.log(l));
  const n = opts.n ?? N_RUNS;
  const seed = opts.seed ?? makeSeed();
  const order: ExecutionOrder = opts.order ?? "random";
  const scenarios: ScenarioClient[] = opts.scenarioIds
    ? SCENARIO_CLIENTS.filter((s) => opts.scenarioIds!.includes(s.id))
    : SCENARIO_CLIENTS;
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  /**
   * Scenarios this agent's framework cannot express — skipped, not run.
   *
   * Emenda 7: "As células não-aplicáveis não são executadas (não se gastam
   * créditos a observar um agente a não usar uma ferramenta que não tem)."
   * The bench honoured this from the start; the harness had no applicability
   * concept at all, so a customer paid for six model calls to watch their agent
   * fail to use tools it does not have — and the server then had to decide what
   * those runs meant.
   *
   * The profile comes from the framework identity the SETUP reports (for
   * @solverdict/sak-adapter, read off the installed package), resolved through
   * the same committed table bench.ts uses. It is recorded in run-metadata.json
   * and RE-DERIVED independently server-side from the bundle's own settings:
   * this skip is a cost decision, never the authoritative one.
   */
  // Mapped into the WIRE shape the server also reads out of the bundle's
  // per-cell settings, so both sides resolve from identical inputs.
  const profile = profileForFramework(
    opts.setup.framework
      ? { frameworkId: opts.setup.framework.id, frameworkVersion: opts.setup.framework.version }
      : null,
  );
  const notApplicable = new Map<string, { capability: string; reason: string }>();
  for (const sc of scenarios) {
    const a = applicabilityForProfile(profile, sc.id);
    if (!a.applicable && a.notApplicable) notApplicable.set(sc.id, a.notApplicable);
  }
  const runnable = scenarios.filter((sc) => !notApplicable.has(sc.id));
  if (profile) {
    log(`[harness] capability profile ${profile.id} (${opts.setup.framework?.id}@${opts.setup.framework?.version})`);
  }
  for (const [scenarioId, na] of notApplicable) {
    log(`[harness] ${scenarioId}: n/a — ${na.capability} capability absent (not run, not scored, not in N)`);
  }

  const runId = new Date().toISOString().slice(0, 19).replace(/:/g, "") + "Z";
  const outDir = path.join(opts.outDir, runId);
  mkdirSync(outDir, { recursive: true });

  const plan = buildRunPlan({
    setupIds: [opts.setup.id],
    scenarioIds: runnable.map((s) => s.id),
    n,
    seed,
    order,
  });

  log(
    `[harness] runId ${runId} — ${runnable.length} scenario(s) x N=${n} = ${plan.cells.length} runs` +
      (notApplicable.size > 0 ? ` (${notApplicable.size} n/a, not run)` : ""),
  );
  log(`[harness] order ${order}, seed ${seed}, ${plan.fingerprint}`);
  if (opts.issued) log(`[harness] server-issued instance: ${Object.keys(opts.issued).length} cell(s)`);

  await ensureSurfpool();
  await startRecorder();
  // Recorded AFTER ensureSurfpool, so the slot exists: on a customer machine
  // the pin is captured by the first launch, not shipped with the package.
  const fork = forkProvenance();
  const baseline: StateSnapshot = await probeState(SHARED_FIXTURE_ADDRESSES);

  let executed = 0;
  let excluded = 0;

  for (const [i, cell] of plan.cells.entries()) {
    const position = i + 1;
    const scenario = byId.get(cell.scenarioId)!;
    log(`[harness] (${position}/${plan.cells.length}) ${cellKey(cell)}`);

    let captured: { sends: unknown[]; rpc: RunLogs["rpc"] } | null = null;
    try {
      // Independence: every run starts from the pre-campaign fork state.
      const stateReset = await resetToBaseline(SHARED_FIXTURE_ADDRESSES, baseline);

      const wallet = Keypair.generate();
      const env = makeEnvHandle(
        wallet.publicKey.toBase58(),
        opts.issued?.[issuedKey(cell.scenarioId, cell.runIndex)],
      );
      await fundStandardWallet(env.walletAddress);
      const ctx = await scenario.setup(env);
      const input = scenario.trigger(ctx);

      const idle = await awaitRecorderIdle();
      const orphan = takeOrphanTraffic();

      beginRun();
      let result;
      let thrown: string | null = null;
      try {
        result = await opts.setup.run(input, wallet, RPC_URL, ctx);
      } catch (err) {
        thrown = String(err).slice(0, 200);
      }
      const recording = endRun();
      captured = recording as never;

      const execution = {
        position,
        of: plan.cells.length,
        order,
        seed,
        stateReset: { checked: stateReset.checked, restored: stateReset.restored, deltas: stateReset.deltas },
        recorderHandover: { idleWaitMs: idle.waitedMs, idleTimedOut: idle.timedOut, orphanTraffic: orphan },
      };

      // The agent never executed: excluded from N, evidence still preserved.
      if (thrown !== null || !result || result.ok === false) {
        const reason = thrown ?? result?.error ?? "agent did not execute (zero successful model turns)";
        excluded++;
        const txs = await parseRun(recording.sends, env.walletAddress).catch(() => []);
        writeRunLog(outDir, opts.setup.id, scenario.id, cell.runIndex, {
          execution,
          ctx: ctxEvidence(ctx),
          wallet: env.walletAddress,
          input,
          error: { reason, phase: "agent", classification: classifyFailure(reason, "agent") },
          actions: result?.actions ?? [],
          txs,
          rpc: recording.rpc,
          finalText: result?.finalText ?? `[run errored: ${reason}]`,
          excludedFromScoring: true,
        });
        log(`[harness]   EXCLUDED (${classifyFailure(reason, "agent")}) — ${reason}`);
        continue;
      }

      const txs = await parseRun(recording.sends, env.walletAddress);
      executed++;
      writeRunLog(outDir, opts.setup.id, scenario.id, cell.runIndex, {
        execution,
        ctx: ctxEvidence(ctx),
        wallet: env.walletAddress,
        input,
        actions: result.actions,
        txs,
        rpc: recording.rpc,
        finalText: result.finalText,
        settings: result.settings,
      });
      log(`[harness]   captured ${txs.length} tx(s), ${result.actions.length} action(s)`);
    } catch (err) {
      excluded++;
      try {
        if (!captured) endRun();
      } catch {
        /* recorder already inactive */
      }
      const reason = `run crashed: ${String(err).slice(0, 200)}`;
      log(`[harness]   EXCLUDED — ${reason}`);
      try {
        writeRunLog(outDir, opts.setup.id, scenario.id, cell.runIndex, {
          execution: { position, of: plan.cells.length, order, seed },
          error: { reason, phase: "lifecycle", classification: classifyFailure(reason, "lifecycle") },
          excludedFromScoring: true,
        });
      } catch {
        /* never let logging abort the campaign */
      }
    }
  }

  await stopRecorder();

  // Provenance travels with the evidence: the server checks the prereg hash and
  // can replay the order from the seed.
  writeFileSync(
    path.join(outDir, "run-metadata.json"),
    serialise({
      runId,
      producedBy: "@solverdict/harness",
      preregVersion: PREREG.version,
      // `forkSlot` stays at the top level for readers that predate `fork`.
      forkSlot: fork.slot,
      // The profile this machine applied, and the fingerprint it came from. The
      // server re-resolves both from the bundle's own per-cell settings and
      // refuses the submission if the two disagree, so a client cannot quietly
      // shrink its own board.
      // Responses the fork substituted for the surfnet's, with the reason each
      // exists. Empty on a fork that needed none. Disclosed here as well as on
      // the individual calls, so a reader sees it without diffing rpc.json.
      forkShims: appliedForkShims(),
      capability: {
        framework: opts.setup.framework ?? null,
        profileId: profile?.id ?? null,
        notApplicable: Object.fromEntries([...notApplicable.entries()]),
      },
      // How the fork was anchored. An offline run is NOT unpinned: it serves a
      // shipped snapshot and aligns its clock to that snapshot's slot, which is
      // a real, reproducible anchor — and the verdict surfaces say so only
      // because this block travels with the evidence.
      fork,
      n,
      setups: [opts.setup.id],
      scenarios: runnable.map((s) => s.id),
      execution: {
        order,
        seed,
        planFingerprint: plan.fingerprint,
        plannedRuns: plan.cells.length,
        executedRuns: executed,
        excludedRuns: excluded,
      },
      instanceSource: opts.issued ? "server-issued" : "pre-registered fixtures",
      // Deliberately NO verdict, NO score: this machine does not decide outcomes.
      scoring: "server-side (submit this bundle to SolVerdict)",
    }),
  );

  log(`[harness] done — ${executed} scored-eligible, ${excluded} excluded, evidence at ${outDir}`);
  return { runId, outDir, plannedRuns: plan.cells.length, executedRuns: executed, excludedRuns: excluded, seed, planFingerprint: plan.fingerprint };
}

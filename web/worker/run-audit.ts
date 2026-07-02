// SPDX-License-Identifier: Apache-2.0
/**
 * Audit worker (Sprint 2) — the body of the audit-worker GitHub Action.
 *
 * It benches the user's ACTUAL endpoint: launch Surfpool, then for each of the
 * 14 scenarios fund an ephemeral wallet, prepare fork state, POST the scenario
 * to the endpoint via the http-agent setup, submit whatever transactions come
 * back, and score the on-chain result with the PARENT scoring (check() →
 * classifyOutcome → scoreSetup). Nothing in the parent harness changes — we
 * reuse env/*, scenarios/*, and scoring/* directly.
 *
 * Safety envelope (see lib/ssrf + lib/audit-protocol):
 *   - endpoint re-validated (HTTPS + public IP) before any outbound call;
 *   - 30s hard timeout + 100 KB response cap per scenario call;
 *   - 15-minute total budget (one GitHub Action job) — scenarios past the
 *     budget are left unrun and reported, never silently dropped;
 *   - every outbound request is logged to `audit:<id>:log` for the audit trail.
 *
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (required);
 *      AUDIT_ID (optional — else RPOP audit_queue); AUDIT_N (default "1").
 */
import { Keypair } from "@solana/web3.js";
import { redis, auditKey, QUEUE_KEY } from "../lib/redis";
import type { AuditRecord, AuditResult, ScenarioProgress } from "../lib/types";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { makeHttpAgentSetup } from "../setups/http-agent";
import { SCENARIOS } from "../../scenarios";
import { scoreSetup, classifyOutcome, type RunRecord } from "../../scoring";
import {
  ensureSurfpool,
  startRecorder,
  stopRecorder,
  beginRun,
  endRun,
  parseRun,
  fundStandardWallet,
  makeEnvHandle,
  readPinnedForkSlot,
  RPC_URL,
} from "../../env";
import type { RunLogs } from "../../lib/types";

const SETUP_ID = "http-agent";
const PREREG_VERSION = "v0.2.2";
const TOTAL_BUDGET_MS = 15 * 60 * 1000; // one GitHub Action job
const AUDIT_N = Math.max(1, Number(process.env.AUDIT_N ?? "1") || 1);
const LOG_KEY = (id: string) => `audit:${id}:log`;

async function save(id: string, rec: AuditRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  await redis().set(auditKey(id), rec);
}

async function resolveId(): Promise<string | null> {
  const explicit = (process.argv[2] ?? process.env.AUDIT_ID)?.trim();
  if (explicit) return explicit;
  return (await redis().rpop<string>(QUEUE_KEY)) ?? null;
}

async function main(): Promise<void> {
  const id = await resolveId();
  if (!id) {
    console.log("[worker] no audit id and audit_queue is empty — nothing to do.");
    return;
  }
  console.log(`[worker] audit ${id}`);

  const rec = await redis().get<AuditRecord>(auditKey(id));
  if (!rec) throw new Error(`audit ${id} not found in Redis`);

  const endpoint = rec.form.endpoint;
  const logLine = async (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(`[worker] ${stamped}`);
    try {
      await redis().lpush(LOG_KEY(id), stamped);
      await redis().ltrim(LOG_KEY(id), 0, 499); // cap the trail
    } catch {
      /* logging must never abort the run */
    }
  };
  // http-agent's onLog is sync; buffer to Redis without awaiting each line.
  const onLog = (line: string) => void logLine(line);

  rec.status = "running";
  rec.progress = { total: SCENARIOS.length, completed: 0, current: null, perScenario: [] };
  await save(id, rec);

  try {
    // Defense in depth: re-validate the endpoint before doing anything outbound.
    await assertPublicHttpsUrl(endpoint);
    await logLine(`endpoint validated: ${endpoint}`);

    console.log("[worker] starting Surfpool…");
    await ensureSurfpool();
    await startRecorder();

    const records: RunRecord[] = [];
    const perScenario: ScenarioProgress[] = [];
    const covered: string[] = [];
    const startedAt = Date.now();
    let budgetExhausted = false;

    for (const scenario of SCENARIOS) {
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
        budgetExhausted = true;
        await logLine(`budget exhausted before ${scenario.id} — remaining scenarios left unrun`);
        break;
      }
      rec.progress!.current = scenario.id;
      await save(id, rec);

      let representative: ScenarioProgress["outcome"] = "errored";
      let anyValid = false;

      for (let n = 0; n < AUDIT_N; n++) {
        try {
          const wallet = Keypair.generate();
          const env = makeEnvHandle(wallet.publicKey.toBase58());
          await fundStandardWallet(env.walletAddress);
          const ctx = await scenario.setup(env);
          const input = scenario.trigger(ctx);

          const setup = makeHttpAgentSetup(endpoint, scenario.id, { onLog });

          beginRun();
          let runResult;
          try {
            runResult = await setup.run(input, wallet, RPC_URL, ctx);
          } catch (err) {
            runResult = undefined;
            await logLine(`${scenario.id} run ${n}: setup.run threw: ${String(err).slice(0, 160)}`);
          }
          const recording = endRun();

          if (!runResult || runResult.ok === false) {
            await logLine(`${scenario.id} run ${n}: EXCLUDED — ${runResult?.error ?? "agent did not execute"}`);
            continue;
          }

          const txs = await parseRun(recording.sends, env.walletAddress);
          const logs: RunLogs = { txs, actions: runResult.actions, rpc: recording.rpc };
          const verdict = scenario.check(logs, ctx);
          const ro = classifyOutcome(scenario.id, logs, ctx, verdict);
          records.push({
            setupId: SETUP_ID,
            scenarioId: scenario.id,
            category: scenario.category,
            runIndex: n,
            verdict,
            outcome: ro.outcome,
          });
          if (!anyValid) representative = ro.outcome;
          anyValid = true;
        } catch (err) {
          try {
            endRun();
          } catch {
            /* recorder already inactive */
          }
          await logLine(`${scenario.id} run ${n}: crashed — ${String(err).slice(0, 160)}`);
        }
      }

      if (anyValid) covered.push(scenario.id);
      perScenario.push({ scenarioId: scenario.id, category: scenario.category, outcome: representative });
      rec.progress!.completed += 1;
      rec.progress!.perScenario = perScenario;
      rec.progress!.current = null;
      await save(id, rec);
    }

    await stopRecorder();

    const score = scoreSetup(SETUP_ID, records);
    const result: AuditResult = {
      setupId: SETUP_ID,
      endpoint,
      framework: rec.form.framework,
      model: rec.form.model,
      preregVersion: PREREG_VERSION,
      forkSlot: readPinnedForkSlot(),
      official: false, // user audits run at N != 20
      n: AUDIT_N,
      scenarios: covered,
      score,
      versions: { surfpool: "1.3.1", "solana-web3.js": "1.98.4", node: process.version },
    };

    rec.status = "done";
    rec.result = result;
    rec.progress!.current = null;
    await save(id, rec);
    await logLine(
      `done — ${covered.length}/${SCENARIOS.length} scenarios scored${budgetExhausted ? " (budget-truncated)" : ""}.`,
    );
    console.log(`[worker] audit ${id} done.`);
  } catch (err) {
    try {
      await stopRecorder();
    } catch {
      /* recorder may not have started */
    }
    const message = err instanceof Error ? err.message : String(err);
    rec.status = "failed";
    rec.error = message;
    await save(id, rec);
    await logLine(`FAILED: ${message}`);
    console.error(`[worker] audit ${id} FAILED: ${message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Audit worker (Sprint 4) — cron-driven (every 5 min). One unit of work per tick:
 *
 *   1. resolve paid audits stuck in `awaiting_payment` (Sprint 3, no Surfpool);
 *   2. SWEEP: move retry-due shards back onto the shard queue;
 *   3. pick ONE unit — prefer a paid SHARD (shard_queue) over a free audit
 *      (audit_queue) — launch Surfpool, run it, persist state.
 *
 * Paid audits are 4 shards ([4,4,4,2] scenarios) each run at N=20; a completed
 * shard enqueues the next, and the last completion aggregates all shards into the
 * final placard (lib/audit-aggregation). Shard failures retry with exponential
 * backoff (5/15/30 min) up to 4 attempts, then fail permanently. Free audits are
 * unchanged: one single-shot run of all 14 scenarios at N=1.
 *
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (required);
 *      SOLVERDICT_PAYMENT_WALLET, SOLANA_RPC_URL, RESEND_API_KEY (payment/email);
 *      AUDIT_ID (optional — run a specific FREE audit).
 */
import { Keypair } from "@solana/web3.js";
import {
  redis,
  auditKey,
  QUEUE_KEY,
  PAYMENT_PENDING_KEY,
  SHARD_QUEUE_KEY,
  SHARD_RETRY_ZSET,
} from "../lib/redis";
import type { AuditRecord, AuditResult, ScenarioProgress, ScenarioResult, Shard } from "../lib/types";
import { isFullyComplete, hasPermanentFailure } from "../lib/types";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { resolveStuckPayment } from "../lib/payment-flow";
import { sendAuditNotification, type NotifyStatus } from "../lib/notify";
import {
  parseShardToken,
  shardToken,
  shardById,
  markShardRunning,
  markShardDone,
  markShardFailedOrRetry,
  nextDispatchableShard,
} from "../lib/shards";
import { SCENARIO_IDS } from "../lib/scenario-ids";
import { aggregateShards } from "../lib/audit-aggregation";
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
const SHARD_BUDGET_MS = 12 * 60 * 1000; // self-cap under the 14-min job timeout
const LOG_KEY = (id: string) => `audit:${id}:log`;
const VERSIONS = { surfpool: "1.3.1", "solana-web3.js": "1.98.4", node: process.version };

async function save(rec: AuditRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  await redis().set(auditKey(rec.id), rec);
}

function makeLogger(id: string) {
  const logLine = async (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(`[worker] ${stamped}`);
    try {
      await redis().lpush(LOG_KEY(id), stamped);
      await redis().ltrim(LOG_KEY(id), 0, 499);
    } catch {
      /* logging must never abort the run */
    }
  };
  return { logLine, onLog: (line: string) => void logLine(line) };
}

function representative(t: ScenarioResult): ScenarioProgress["outcome"] {
  if (t.n === 0) return "errored";
  if (t.uncontained > 0) return "uncontained";
  if (t.intentDangerousExecFailed > 0) return "intent-dangerous-exec-failed";
  return "contained";
}

async function notify(rec: AuditRecord, status: NotifyStatus, summary?: string): Promise<void> {
  const res = await sendAuditNotification({
    to: rec.form.email,
    auditId: rec.id,
    endpoint: rec.form.endpoint,
    status,
    summary,
  });
  if (!res.sent && !res.skipped) console.warn(`[worker] email not sent: ${res.reason}`);
}

/**
 * Run one scenario N times against the endpoint, tallying outcomes. Shared by the
 * shard and free-audit paths. Errored runs (agent never executed) are excluded.
 */
async function benchScenario(
  scenario: (typeof SCENARIOS)[number],
  endpoint: string,
  N: number,
  deadline: number,
  onLog: (line: string) => void,
): Promise<{ tally: ScenarioResult; records: RunRecord[] }> {
  let contained = 0;
  let uncontained = 0;
  let intent = 0;
  const records: RunRecord[] = [];

  for (let i = 0; i < N; i++) {
    if (Date.now() > deadline) break;
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
        onLog(`${scenario.id} run ${i}: setup.run threw: ${String(err).slice(0, 140)}`);
      }
      const recording = endRun();

      if (!runResult || runResult.ok === false) {
        onLog(`${scenario.id} run ${i}: EXCLUDED — ${runResult?.error ?? "agent did not execute"}`);
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
        runIndex: i,
        verdict,
        outcome: ro.outcome,
      });
      if (ro.outcome === "contained") contained++;
      else if (ro.outcome === "uncontained") uncontained++;
      else intent++;
    } catch (err) {
      try {
        endRun();
      } catch {
        /* recorder already inactive */
      }
      onLog(`${scenario.id} run ${i}: crashed — ${String(err).slice(0, 140)}`);
    }
  }

  const tally: ScenarioResult = {
    scenarioId: scenario.id,
    category: scenario.category,
    n: contained + uncontained + intent,
    contained,
    uncontained,
    intentDangerousExecFailed: intent,
  };
  return { tally, records };
}

/** Finalize a paid audit once all shards are terminal (all done, or some failed). */
async function finalizeAudit(rec: AuditRecord): Promise<void> {
  const agg = aggregateShards(rec.shards!, SETUP_ID, [...SCENARIO_IDS]);
  const result: AuditResult = {
    setupId: SETUP_ID,
    endpoint: rec.form.endpoint,
    framework: rec.form.framework,
    model: rec.form.model,
    tier: rec.tier,
    preregVersion: PREREG_VERSION,
    forkSlot: readPinnedForkSlot(),
    official: false,
    n: rec.n,
    scenarios: agg.covered,
    score: agg.score,
    versions: VERSIONS,
  };
  rec.result = result;

  const permanent = hasPermanentFailure(rec);
  if (isFullyComplete(rec)) {
    rec.status = "done";
    await save(rec);
    await notify(rec, "done", `${agg.covered.length}/${SCENARIO_IDS.length} scenarios scored`);
  } else if (permanent) {
    const failedIds = rec.shards!.filter((s) => s.status === "failed").map((s) => s.shardId);
    rec.status = "failed";
    rec.error = `shard(s) ${failedIds.join(", ")} failed after max retries; ${agg.covered.length}/${SCENARIO_IDS.length} scenarios scored`;
    await save(rec);
    await notify(rec, "failed", rec.error);
  }
}

/** Enqueue the next never-attempted shard, if any. */
async function dispatchNext(rec: AuditRecord): Promise<void> {
  const next = nextDispatchableShard(rec.shards ?? []);
  if (next) await redis().lpush(SHARD_QUEUE_KEY, shardToken(rec.id, next.shardId));
}

/** Process one paid shard (Surfpool must already be up). */
async function runOneShard(token: string, deadline: number): Promise<void> {
  const parsed = parseShardToken(token);
  if (!parsed) {
    console.warn(`[worker] bad shard token: ${token}`);
    return;
  }
  const { auditId, shardId } = parsed;
  const rec = await redis().get<AuditRecord>(auditKey(auditId));
  if (!rec?.shards) {
    console.warn(`[worker] ${token}: audit/shards not found`);
    return;
  }
  const shard = shardById(rec.shards, shardId) as Shard | undefined;
  if (!shard) {
    console.warn(`[worker] ${token}: shard ${shardId} not found`);
    return;
  }
  if (shard.status === "done" || shard.status === "failed") {
    console.log(`[worker] ${token}: already ${shard.status}, skipping`);
    return;
  }

  const { logLine, onLog } = makeLogger(auditId);
  markShardRunning(shard, Date.now());
  if (rec.status === "queued") rec.status = "running";
  await save(rec);
  await logLine(`shard ${shardId}/${rec.shards.length} running (attempt ${shard.attempts}) — [${shard.scenarios.join(", ")}] N=${shard.N}`);

  try {
    await assertPublicHttpsUrl(rec.form.endpoint);
    const scenarios = SCENARIOS.filter((s) => shard.scenarios.includes(s.id));
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      if (Date.now() > deadline) throw new Error("shard exceeded time budget");
      const { tally } = await benchScenario(scenario, rec.form.endpoint, shard.N, deadline, onLog);
      results.push(tally);
      await logLine(`shard ${shardId}: ${scenario.id} → ${tally.contained}/${tally.n} contained`);
    }

    markShardDone(shard, results, Date.now());
    await save(rec);
    await logLine(`shard ${shardId} done`);

    if (isFullyComplete(rec) || hasPermanentFailure(rec)) {
      await finalizeAudit(rec);
    } else {
      await dispatchNext(rec);
    }
  } catch (err) {
    const message = String(err).slice(0, 200);
    const { permanent, nextAttemptAt } = markShardFailedOrRetry(shard, Date.now(), message);
    await save(rec);
    if (!permanent && nextAttemptAt) {
      await redis().zadd(SHARD_RETRY_ZSET, { score: nextAttemptAt, member: token });
      await logLine(`shard ${shardId} failed (attempt ${shard.attempts}) — retry at ${new Date(nextAttemptAt).toISOString()}: ${message}`);
    } else {
      await logLine(`shard ${shardId} permanently failed after ${shard.attempts} attempts: ${message}`);
    }
    // Keep progress moving: dispatch the next never-attempted shard regardless.
    await dispatchNext(rec);
    // If nothing is left in flight, finalize (partial if any permanent failure).
    if (isFullyComplete(rec) || (hasPermanentFailure(rec) && rec.shards!.every((s) => s.status === "done" || s.status === "failed"))) {
      await finalizeAudit(rec);
    }
  }
}

/** Process one free (single-shot) audit — all 14 scenarios at N=1 in one tick. */
async function runFreeAudit(id: string, deadline: number): Promise<void> {
  const rec = await redis().get<AuditRecord>(auditKey(id));
  if (!rec) {
    console.warn(`[worker] ${id}: not found`);
    return;
  }
  if (rec.status !== "queued") {
    console.log(`[worker] ${id}: status ${rec.status}, not queued — skipping`);
    return;
  }
  if (rec.shards) {
    console.log(`[worker] ${id}: paid audit — processed via shard_queue, skipping free path`);
    return;
  }

  const { logLine, onLog } = makeLogger(id);
  const n = Math.max(1, rec.n || 1);
  rec.status = "running";
  rec.progress = { total: SCENARIOS.length, completed: 0, current: null, perScenario: [] };
  await save(rec);

  try {
    await assertPublicHttpsUrl(rec.form.endpoint);
    await logLine(`endpoint validated: ${rec.form.endpoint} (tier=${rec.tier}, N=${n})`);

    const records: RunRecord[] = [];
    const perScenario: ScenarioProgress[] = [];
    const covered: string[] = [];
    let budgetExhausted = false;

    for (const scenario of SCENARIOS) {
      if (Date.now() > deadline) {
        budgetExhausted = true;
        await logLine(`budget exhausted before ${scenario.id}`);
        break;
      }
      rec.progress!.current = scenario.id;
      await save(rec);
      const { tally, records: recs } = await benchScenario(scenario, rec.form.endpoint, n, deadline, onLog);
      records.push(...recs);
      if (tally.n > 0) covered.push(scenario.id);
      perScenario.push({ scenarioId: scenario.id, category: scenario.category, outcome: representative(tally) });
      rec.progress!.completed += 1;
      rec.progress!.perScenario = perScenario;
      rec.progress!.current = null;
      await save(rec);
    }

    const score = scoreSetup(SETUP_ID, records);
    rec.result = {
      setupId: SETUP_ID,
      endpoint: rec.form.endpoint,
      framework: rec.form.framework,
      model: rec.form.model,
      tier: rec.tier,
      preregVersion: PREREG_VERSION,
      forkSlot: readPinnedForkSlot(),
      official: false,
      n,
      scenarios: covered,
      score,
      versions: VERSIONS,
    };
    rec.status = "done";
    rec.progress!.current = null;
    await save(rec);
    const uncontained = [...new Set(records.filter((r) => r.outcome === "uncontained").map((r) => r.scenarioId))].sort();
    const summary =
      (covered.length === 0
        ? "no scenarios produced a valid run"
        : uncontained.length
          ? `${covered.length}/${SCENARIOS.length} scored; uncontained: ${uncontained.join(", ")}`
          : `${covered.length}/${SCENARIOS.length} scored; all contained`) + (budgetExhausted ? " (budget-truncated)" : "");
    await logLine(`done — ${summary}`);
    await notify(rec, "done", summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rec.status = "failed";
    rec.error = message;
    await save(rec);
    await logLine(`FAILED: ${message}`);
    await notify(rec, "failed", message);
  }
}

/** Move retry-due shards back onto the shard queue. */
async function sweepRetries(now: number): Promise<void> {
  let due: string[] = [];
  try {
    due = await redis().zrange<string[]>(SHARD_RETRY_ZSET, 0, now, { byScore: true });
  } catch (err) {
    console.warn(`[worker] retry sweep failed: ${String(err)}`);
    return;
  }
  for (const token of due) {
    const parsed = parseShardToken(token);
    if (!parsed) {
      await redis().zrem(SHARD_RETRY_ZSET, token);
      continue;
    }
    const rec = await redis().get<AuditRecord>(auditKey(parsed.auditId));
    const shard = rec?.shards ? shardById(rec.shards, parsed.shardId) : undefined;
    if (!rec || !shard || shard.status !== "retrying") {
      await redis().zrem(SHARD_RETRY_ZSET, token);
      continue;
    }
    shard.status = "queued"; // attempts preserved so it won't be re-dispatched as a first-timer
    await save(rec);
    await redis().lpush(SHARD_QUEUE_KEY, token);
    await redis().zrem(SHARD_RETRY_ZSET, token);
    console.log(`[worker] swept retry ${token} back onto shard_queue`);
  }
}

async function main(): Promise<void> {
  // 1. Resolve stuck payments (no Surfpool required).
  try {
    const pending = await redis().lrange<string>(PAYMENT_PENDING_KEY, 0, 49);
    for (const pid of pending) {
      try {
        const outcome = await resolveStuckPayment(pid);
        console.log(`[worker] payment ${pid}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`);
      } catch (err) {
        console.warn(`[worker] payment ${pid} resolve error: ${String(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[worker] payment-pending scan failed: ${String(err)}`);
  }

  // 2. Sweep retry-due shards back onto the queue.
  await sweepRetries(Date.now());

  // 3. Pick ONE unit of work — a manual free audit, else a paid shard, else a free audit.
  const explicit = (process.argv[2] ?? process.env.AUDIT_ID)?.trim();
  if (explicit) {
    console.log(`[worker] AUDIT_ID override: ${explicit}`);
    await withSurfpool((deadline) => runFreeAudit(explicit, deadline));
    return;
  }

  const shardTok = await redis().rpop<string>(SHARD_QUEUE_KEY);
  if (shardTok) {
    console.log(`[worker] processing shard ${shardTok}`);
    await withSurfpool((deadline) => runOneShard(shardTok, deadline));
    return;
  }

  const freeId = await redis().rpop<string>(QUEUE_KEY);
  if (freeId) {
    console.log(`[worker] processing free audit ${freeId}`);
    await withSurfpool((deadline) => runFreeAudit(freeId, deadline));
    return;
  }

  console.log("[worker] nothing queued to run.");
}

/** Launch Surfpool + recorder, run the unit under the shard budget, then stop. */
async function withSurfpool(unit: (deadline: number) => Promise<void>): Promise<void> {
  console.log("[worker] starting Surfpool…");
  await ensureSurfpool();
  await startRecorder();
  try {
    await unit(Date.now() + SHARD_BUDGET_MS);
  } finally {
    await stopRecorder();
  }
  console.log("[worker] unit done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

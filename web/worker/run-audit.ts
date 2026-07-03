// SPDX-License-Identifier: Apache-2.0
/**
 * Audit worker (Sprint 5) — an always-on process (Railway) that drains the
 * Supabase queue. No cron, no sharding: each audit runs single-shot at its full
 * N (1 for free, 20 for paid) across all 14 scenarios.
 *
 * Loop:
 *   1. periodic maintenance — reclaim stale claims (crashed workers) and resolve
 *      paid audits stuck in `awaiting_payment`;
 *   2. atomically claim the next queued audit (`claim_next_audit` — FOR UPDATE
 *      SKIP LOCKED, so multiple workers never take the same one);
 *   3. if none, sleep and loop;
 *   4. ensure Surfpool is up, run the audit, persist results, delete the queue row.
 *
 * Graceful shutdown: on SIGTERM/SIGINT we stop claiming new work and let the
 * in-flight audit finish before exiting. If the platform hard-kills us mid-audit,
 * `reclaim_stale_claims` requeues it on the next worker's maintenance tick.
 *
 * Health: writes `/tmp/worker-alive` (mtime) every 30s for a container healthcheck.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required);
 *      SOLVERDICT_PAYMENT_WALLET, SOLANA_RPC_URL, RESEND_API_KEY (payment/email);
 *      AUDIT_BUDGET_MS, WORKER_POLL_MS, WORKER_ID (optional).
 */
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { Keypair } from "@solana/web3.js";
import { supabaseAdmin, type AuditRow } from "../lib/supabase";
import type { AuditResult, ScenarioProgress, ScenarioResult } from "../lib/types";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { resolveStuckPayment } from "../lib/payment-flow";
import { sendAuditNotification, type NotifyStatus } from "../lib/notify";
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
const HEALTH_FILE = "/tmp/worker-alive";
const HEARTBEAT_MS = 30_000;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000);
const AUDIT_BUDGET_MS = Number(process.env.AUDIT_BUDGET_MS ?? 30 * 60 * 1000);
const MAINTENANCE_MS = 60_000;
const STALE_CLAIM_MINUTES = Number(process.env.STALE_CLAIM_MINUTES ?? 45);
const VERSIONS = { surfpool: "1.3.1", "solana-web3.js": "1.98.4", node: process.version };
const WORKER_ID = process.env.WORKER_ID ?? `${hostname()}-${process.pid}`;

let shuttingDown = false;

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function fetchRow(id: string): Promise<AuditRow | null> {
  const { data, error } = await supabaseAdmin().from("audits").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AuditRow | null) ?? null;
}

async function updateAudit(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("audits")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function deleteQueue(id: string): Promise<void> {
  await supabaseAdmin().from("queue").delete().eq("audit_id", id);
}

async function emitEvent(id: string, eventType: string, payload?: unknown): Promise<void> {
  try {
    await supabaseAdmin().from("audit_events").insert({ audit_id: id, event_type: eventType, payload: payload ?? null });
  } catch (err) {
    console.warn(`[worker] event ${eventType} for ${id} not recorded: ${String(err)}`);
  }
}

/** Release a claim (e.g. Surfpool couldn't start) so the audit is retried later. */
async function releaseClaim(id: string): Promise<void> {
  try {
    await supabaseAdmin().from("queue").update({ claimed_at: null, claimed_by: null }).eq("audit_id", id);
    await supabaseAdmin().from("audits").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
  } catch (err) {
    console.warn(`[worker] releaseClaim(${id}) failed: ${String(err)}`);
  }
}

async function notify(row: AuditRow, status: NotifyStatus, summary?: string): Promise<void> {
  const res = await sendAuditNotification({
    to: row.email ?? undefined,
    auditId: row.id,
    endpoint: row.endpoint,
    status,
    summary,
  });
  if (!res.sent && !res.skipped) console.warn(`[worker] email not sent: ${res.reason}`);
}

// ---------------------------------------------------------------------------
// Benchmark one scenario N times
// ---------------------------------------------------------------------------

function representative(t: ScenarioResult): ScenarioProgress["outcome"] {
  if (t.n === 0) return "errored";
  if (t.uncontained > 0) return "uncontained";
  if (t.intentDangerousExecFailed > 0) return "intent-dangerous-exec-failed";
  return "contained";
}

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

// ---------------------------------------------------------------------------
// Run one claimed audit (single-shot, all 14 scenarios at N)
// ---------------------------------------------------------------------------

async function runAudit(id: string): Promise<void> {
  const row = await fetchRow(id);
  if (!row) {
    console.warn(`[worker] ${id}: claimed but row not found — dropping queue entry`);
    await deleteQueue(id);
    return;
  }

  const N = Math.max(1, row.n || 1);
  const onLog = (line: string) => console.log(`[worker] ${id} ${line}`);
  const deadline = Date.now() + AUDIT_BUDGET_MS;

  const progress = { total: SCENARIOS.length, completed: 0, current: null as string | null, perScenario: [] as ScenarioProgress[] };

  try {
    await assertPublicHttpsUrl(row.endpoint);
    onLog(`endpoint validated: ${row.endpoint} (tier=${row.tier}, N=${N})`);
    await updateAudit(id, { progress });
    await emitEvent(id, "started", { worker: WORKER_ID, n: N });

    const records: RunRecord[] = [];
    const covered: string[] = [];
    let budgetExhausted = false;

    for (const scenario of SCENARIOS) {
      if (Date.now() > deadline) {
        budgetExhausted = true;
        onLog(`budget exhausted before ${scenario.id}`);
        break;
      }
      progress.current = scenario.id;
      await updateAudit(id, { progress });

      const { tally, records: recs } = await benchScenario(scenario, row.endpoint, N, deadline, onLog);
      records.push(...recs);
      if (tally.n > 0) covered.push(scenario.id);
      progress.perScenario.push({ scenarioId: scenario.id, category: scenario.category, outcome: representative(tally) });
      progress.completed += 1;
      progress.current = null;
      await updateAudit(id, { progress });
      onLog(`${scenario.id} → ${tally.contained}/${tally.n} contained`);
    }

    const score = scoreSetup(SETUP_ID, records);
    const result: AuditResult = {
      setupId: SETUP_ID,
      endpoint: row.endpoint,
      framework: row.framework,
      model: row.model,
      tier: row.tier,
      preregVersion: PREREG_VERSION,
      forkSlot: readPinnedForkSlot(),
      official: false,
      n: N,
      scenarios: covered,
      score,
      versions: VERSIONS,
    };

    await updateAudit(id, { status: "done", results: result, progress, finished_at: new Date().toISOString() });
    await deleteQueue(id);

    const uncontained = [...new Set(records.filter((r) => r.outcome === "uncontained").map((r) => r.scenarioId))].sort();
    const summary =
      (covered.length === 0
        ? "no scenarios produced a valid run"
        : uncontained.length
          ? `${covered.length}/${SCENARIOS.length} scored; uncontained: ${uncontained.join(", ")}`
          : `${covered.length}/${SCENARIOS.length} scored; all contained`) + (budgetExhausted ? " (budget-truncated)" : "");
    onLog(`done — ${summary}`);
    await emitEvent(id, "done", { covered: covered.length, summary });
    await notify(row, "done", summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAudit(id, { status: "failed", error: message, finished_at: new Date().toISOString() });
    await deleteQueue(id);
    onLog(`FAILED: ${message}`);
    await emitEvent(id, "failed", { error: message });
    await notify(row, "failed", message);
  }
}

// ---------------------------------------------------------------------------
// Maintenance: reclaim stale claims + resolve stuck payments
// ---------------------------------------------------------------------------

async function maintenance(): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin().rpc("reclaim_stale_claims", { p_older_than_minutes: STALE_CLAIM_MINUTES });
    if (error) throw new Error(error.message);
    if (typeof data === "number" && data > 0) console.log(`[worker] reclaimed ${data} stale claim(s)`);
  } catch (err) {
    console.warn(`[worker] reclaim_stale_claims failed: ${String(err)}`);
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from("audits")
      .select("id")
      .eq("status", "awaiting_payment")
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string }[]) {
      try {
        const outcome = await resolveStuckPayment(r.id);
        if (outcome.status !== "awaiting_payment") {
          console.log(`[worker] payment ${r.id}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`);
        }
      } catch (err) {
        console.warn(`[worker] payment ${r.id} resolve error: ${String(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[worker] awaiting_payment scan failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function heartbeat(): void {
  try {
    writeFileSync(HEALTH_FILE, new Date().toISOString());
  } catch {
    /* health file is best-effort */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function claimNext(): Promise<string | null> {
  const { data, error } = await supabaseAdmin().rpc("claim_next_audit", { p_worker_id: WORKER_ID });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

async function main(): Promise<void> {
  console.log(`[worker] starting — id=${WORKER_ID}, poll=${POLL_MS}ms, budget=${AUDIT_BUDGET_MS}ms`);
  heartbeat();
  const beat = setInterval(heartbeat, HEARTBEAT_MS);

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      if (!shuttingDown) console.log(`[worker] ${sig} received — finishing current audit, then exiting`);
      shuttingDown = true;
    });
  }

  let lastMaintenance = 0;

  try {
    while (!shuttingDown) {
      if (Date.now() - lastMaintenance > MAINTENANCE_MS) {
        await maintenance();
        lastMaintenance = Date.now();
      }
      if (shuttingDown) break;

      let id: string | null;
      try {
        id = await claimNext();
      } catch (err) {
        console.warn(`[worker] claim failed: ${String(err)} — backing off`);
        await sleep(POLL_MS);
        continue;
      }

      if (!id) {
        await sleep(POLL_MS);
        continue;
      }

      console.log(`[worker] claimed ${id}`);
      try {
        await ensureSurfpool();
        await startRecorder();
      } catch (err) {
        console.error(`[worker] Surfpool did not start: ${String(err)} — releasing ${id}`);
        try {
          await stopRecorder();
        } catch {
          /* recorder may not have started */
        }
        await releaseClaim(id);
        await sleep(POLL_MS * 3);
        continue;
      }

      try {
        await runAudit(id);
      } finally {
        try {
          await stopRecorder();
        } catch {
          /* best effort */
        }
      }
    }
  } finally {
    clearInterval(beat);
    console.log("[worker] stopped.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

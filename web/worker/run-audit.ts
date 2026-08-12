// SPDX-License-Identifier: Apache-2.0
/**
 * Audit worker — an always-on process (Railway) that drains the Supabase queue.
 *
 * WHAT THE JOB IS NOW. Re-scoring a submitted evidence bundle, not driving an
 * agent. The audit itself runs on the customer's machine (their agent, their
 * fork, their localhost:8899) and arrives here as evidence; this process
 * decides the verdict from it. See worker/rescore-audit.ts for why that had to
 * move, and for what the server still refuses to take the client's word on.
 *
 * The consequence for this file is smaller than it sounds: everything except
 * the body of the job is unchanged, because re-scoring is still asynchronous
 * work that can die halfway through. One thing did fall away — a re-scoring
 * worker needs no Surfpool and no RPC recorder, so it no longer starts them,
 * and an audit is no longer released back to the queue because a validator
 * would not boot.
 *
 * Loop:
 *   1. periodic maintenance — reclaim stale claims (crashed workers) and resolve
 *      paid audits stuck in `awaiting_payment`;
 *   2. atomically claim the next queued audit (`claim_next_audit` — FOR UPDATE
 *      SKIP LOCKED, so multiple workers never take the same one);
 *   3. if none, sleep and loop;
 *   4. re-score its evidence bundle, persist results, delete the queue row.
 *
 * Graceful shutdown: on SIGTERM/SIGINT we stop claiming new work and let the
 * in-flight audit finish before exiting. If the platform hard-kills us mid-audit,
 * `reclaim_stale_claims` requeues it on the next worker's maintenance tick.
 *
 * Health: writes `/tmp/worker-alive` (mtime) every 30s for a container healthcheck.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required);
 *      SOLVERDICT_PAYMENT_WALLET, SOLANA_RPC_URL, RESEND_API_KEY (payment/email);
 *      WORKER_POLL_MS, WORKER_ID (optional).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { supabaseAdmin, type AuditRow } from "../lib/supabase";
import { resolveStuckPayment, rescueFailedPayment } from "../lib/payment-flow";
import { PAYMENT_MAX_AGE_MS } from "../lib/payment";
import { sendAuditNotification, agentLabel, type NotifyStatus } from "../lib/notify";
import { SCENARIOS } from "../../scenarios";
import { PREREG } from "../../config/prereg";
import { rescoreSubmission } from "./rescore-audit";
import { supabaseEvidenceStore } from "../lib/evidence-storage";

/**
 * Methodology version, DERIVED — never restated here.
 *
 * This constant used to be the string "v0.2.2" while the worker imported
 * SCENARIOS from the v0.3.0 rubric: the SaaS ran 20 scenarios and stamped the
 * result as v0.2.2. A paid audit misreported the methodology it had run under,
 * which is the same provenance defect the bench had (audit D3) and the reason
 * config/prereg.ts exists. The version, the scenario count and the category
 * count are declared in exactly one place; every path reads them from there.
 */
const PREREG_VERSION = PREREG.version;
const HEALTH_FILE = "/tmp/worker-alive";
const HEARTBEAT_MS = 30_000;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000);
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

async function notify(row: AuditRow, status: NotifyStatus, summary?: string): Promise<void> {
  const res = await sendAuditNotification({
    to: row.email ?? undefined,
    auditId: row.id,
    agent: agentLabel(row),
    status,
    summary,
  });
  if (!res.sent && !res.skipped) console.warn(`[worker] email not sent: ${res.reason}`);
}

// ---------------------------------------------------------------------------
// The job: re-score one claimed audit's submitted evidence
// ---------------------------------------------------------------------------

/**
 * Fetches the bundle intake stored and drops it in this worker's scratch.
 *
 * The reference is opaque: it is a key in shared storage, not a path. The
 * previous version treated it as a path and opened it directly, which worked in
 * the single-process proof and failed the moment intake (Vercel) and the worker
 * (Railway) turned out to be different machines.
 */
async function fetchBundle(ref: string, workDir: string): Promise<string> {
  const bytes = await supabaseEvidenceStore().get(ref);
  const local = path.join(workDir, "bundle.tar.gz");
  writeFileSync(local, bytes);
  return local;
}

async function rescoreAudit(id: string): Promise<void> {
  const row = await fetchRow(id);
  if (!row) {
    console.warn(`[worker] ${id}: claimed but row not found — dropping queue entry`);
    await deleteQueue(id);
    return;
  }

  const onLog = (line: string) => console.log(`[worker] ${id} ${line}`);
  const workDir = mkdtempSync(path.join(tmpdir(), `rescore-${id}-`));

  try {
    if (!row.evidence_ref) {
      // Fails rather than waits: the queue row exists because intake put it
      // there, and intake only does that after storing a verified bundle.
      throw new Error("audit was queued with no evidence bundle");
    }
    await updateAudit(id, { progress: { total: SCENARIOS.length, completed: 0, current: null, perScenario: [] } });
    await emitEvent(id, "started", { worker: WORKER_ID, n: row.n, mode: "rescore" });
    onLog(`re-scoring ${row.evidence_ref} (N=${row.n}, tier=${row.tier})`);

    const bundlePath = await fetchBundle(row.evidence_ref, workDir);
    const { result, progress, rederivation, mismatches, dataQuality, summary } = rescoreSubmission({
      bundlePath,
      workDir,
      n: row.n,
      framework: row.framework,
      model: row.model,
      tier: row.tier,
      // No forkSlot here any more: rescoreSubmission reads it from the bundle's
      // run-metadata.json. It used to come from `evidence_manifest.forkSlot`,
      // a field the harness manifest never had, so every audit scored as
      // "unpinned" regardless of how its fork was actually anchored.
      versions: VERSIONS,
    });

    onLog(
      `magnitude re-derived server-side: ${rederivation.rederived}/` +
        `${rederivation.rederived + rederivation.decodeOnly + rederivation.legacyAsserted} tx(s)`,
    );
    if (dataQuality.length > 0) {
      // Not an error and not an exclusion: a cell whose "contained" rests on a
      // tool error rather than a decision. Surfaced so it can be reviewed
      // instead of quietly counting as containment.
      onLog(`data-quality: ${dataQuality.length} cell(s) need review — ${dataQuality.map((d) => d.scenarioId).join(", ")}`);
      await emitEvent(id, "data-quality", { cells: dataQuality });
    }
    if (mismatches > 0) {
      // The client should ship no verdicts at all; if one appears and disagrees
      // with ours, ours stands and the discrepancy is on the record.
      onLog(`WARNING: ${mismatches} run(s) carried a verdict that differs from the re-scored one`);
      await emitEvent(id, "verdict-mismatch", { count: mismatches });
    }

    await updateAudit(id, {
      status: "done",
      results: result,
      progress: { total: SCENARIOS.length, completed: progress.length, current: null, perScenario: progress },
      finished_at: new Date().toISOString(),
    });
    await deleteQueue(id);

    onLog(`done — ${summary}`);
    await emitEvent(id, "done", { covered: result.scenarios.length, summary });
    await notify(row, "done", summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAudit(id, { status: "failed", error: message, finished_at: new Date().toISOString() });
    await deleteQueue(id);
    onLog(`FAILED: ${message}`);
    await emitEvent(id, "failed", { error: message });
    await notify(row, "failed", message);
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* scratch only */
    }
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

  // Rescue late payments: payment_failed audits that DO have a signature and are
  // still within the 24h window may have confirmed after the grace period.
  // Re-verify on-chain and, if valid, move them back to queued.
  try {
    const cutoff = new Date(Date.now() - PAYMENT_MAX_AGE_MS).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("audits")
      .select("id")
      .eq("status", "payment_failed")
      .not("payment_signature", "is", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string }[]) {
      try {
        const outcome = await rescueFailedPayment(r.id);
        if (outcome.ok) {
          console.log(`[worker] rescued late payment ${r.id} → ${outcome.status}`);
        }
      } catch (err) {
        console.warn(`[worker] payment ${r.id} rescue error: ${String(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[worker] payment_failed rescue scan failed: ${String(err)}`);
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
  console.log(`[worker] starting — id=${WORKER_ID}, poll=${POLL_MS}ms, mode=rescore`);
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
      await rescoreAudit(id);
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


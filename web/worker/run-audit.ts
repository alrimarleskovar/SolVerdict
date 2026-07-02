// SPDX-License-Identifier: Apache-2.0
/**
 * Audit worker — the body of the audit-worker GitHub Action.
 *
 * Flow:
 *   1. Resolve an audit id (CLI arg / AUDIT_ID env, else RPOP the audit_queue).
 *   2. Mark the record `running`.
 *   3. Spawn the PARENT bench (`npm run bench`) restricted to the reference
 *      setup mapped from the submission, over a small scenario subset. We shell
 *      out rather than import bench.ts so nothing in the parent harness has to
 *      change (constraint: do NOT touch bench.ts).
 *   4. Read the parent's report/results.json, lift the setup's SetupScore, and
 *      write it back to Redis as the audit result with status `done`.
 *   5. Any failure marks the record `failed` with the reason.
 *
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (required);
 *      ANTHROPIC_API_KEY / OPENAI_API_KEY (as the chosen setup needs);
 *      AUDIT_ID (optional), AUDIT_SCENARIOS (default "A1,A2,A3"),
 *      AUDIT_N (default "2").
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redis, auditKey, QUEUE_KEY } from "../lib/redis";
import type { AuditRecord, AuditResult } from "../lib/types";
import type { SetupScore } from "../../scoring";

/**
 * Minimal structural view of the parent's report/results.json. Declared locally
 * (rather than importing ResultsFile from report/generate.ts) so the /web
 * typecheck does not pull in the parent's heavy scenario graph — we only read
 * meta + each setup's SetupScore.
 */
interface ResultsFileShape {
  meta: {
    preregVersion: string;
    forkSlot: number | null;
    official: boolean;
    versions: Record<string, string>;
  };
  setups: Array<{ setupId: string; score: SetupScore }>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const RESULTS_PATH = path.join(REPO_ROOT, "report", "results.json");

const SCENARIOS = (process.env.AUDIT_SCENARIOS ?? "A1,A2,A3").trim();
const N = (process.env.AUDIT_N ?? "2").trim();

async function patch(id: string, rec: AuditRecord, next: Partial<AuditRecord>): Promise<AuditRecord> {
  const updated: AuditRecord = { ...rec, ...next, updatedAt: new Date().toISOString() };
  await redis().set(auditKey(id), updated);
  return updated;
}

async function resolveId(): Promise<string | null> {
  const explicit = (process.argv[2] ?? process.env.AUDIT_ID)?.trim();
  if (explicit) return explicit;
  const popped = await redis().rpop<string>(QUEUE_KEY);
  return popped ?? null;
}

async function main(): Promise<void> {
  const id = await resolveId();
  if (!id) {
    console.log("[worker] no audit id supplied and audit_queue is empty — nothing to do.");
    return;
  }
  console.log(`[worker] audit ${id}`);

  const rec = await redis().get<AuditRecord>(auditKey(id));
  if (!rec) {
    throw new Error(`audit ${id} not found in Redis`);
  }

  let current = await patch(id, rec, { status: "running" });
  const setupId = current.mappedSetup;
  console.log(`[worker] running bench: setup=${setupId} scenarios=${SCENARIOS} n=${N}`);

  try {
    const res = spawnSync(
      "npm",
      ["run", "bench", "--", "--setups", setupId, "--scenarios", SCENARIOS, "--n", N],
      { cwd: REPO_ROOT, stdio: "inherit", env: process.env },
    );
    if (res.status !== 0) {
      throw new Error(`bench exited with code ${res.status ?? "null"}${res.error ? `: ${res.error.message}` : ""}`);
    }

    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as ResultsFileShape;
    const setup = results.setups.find((s) => s.setupId === setupId);
    if (!setup) {
      throw new Error(`setup ${setupId} not present in ${RESULTS_PATH}`);
    }

    const result: AuditResult = {
      setupId: setup.setupId,
      preregVersion: results.meta.preregVersion,
      forkSlot: results.meta.forkSlot,
      official: results.meta.official,
      n: Number(N),
      scenarios: SCENARIOS.split(",").map((s) => s.trim()),
      score: setup.score,
      versions: results.meta.versions,
    };

    await patch(id, current, { status: "done", result });
    console.log(`[worker] audit ${id} done — setup ${setupId} scored.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patch(id, current, { status: "failed", error: message });
    console.error(`[worker] audit ${id} FAILED: ${message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

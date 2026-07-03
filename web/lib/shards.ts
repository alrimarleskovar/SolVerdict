// SPDX-License-Identifier: Apache-2.0
/**
 * Shard construction, queue-token encoding, and the pure shard state machine
 * (Sprint 4). Everything here is side-effect free so it can be unit-tested
 * without Redis or Surfpool; the worker wraps these with Redis I/O.
 *
 * State machine (per shard):
 *
 *   queued ──(worker picks it up)──▶ running ──success──▶ done
 *      ▲                               │
 *      │                               ├─fail & attempts<MAX─▶ retrying ──(nextAttemptAt≤now, sweep)──┐
 *      └───────────────────────────────┘                                                              │
 *                                        └─fail & attempts≥MAX─▶ failed (permanent)                    │
 *      ▲──────────────────────────────────────────────────────────────────────────────────────────────┘
 *      (sweep re-queues, attempts preserved)
 */
import { backoffMs, MAX_ATTEMPTS } from "./backoff";
import type { ScenarioResult, Shard } from "./types";

/** Scenarios per shard. 14 scenarios → [4,4,4,2] = 4 shards. */
export const SHARD_SIZE = 4;

/** Split a scenario-id list into shards ([4,4,4,2] for the 14-scenario board). */
export function buildShards(scenarioIds: string[], n: number): Shard[] {
  const shards: Shard[] = [];
  for (let i = 0; i < scenarioIds.length; i += SHARD_SIZE) {
    shards.push({
      shardId: shards.length + 1, // 1-indexed for display ("Shard 2 of 4")
      scenarios: scenarioIds.slice(i, i + SHARD_SIZE),
      N: n,
      status: "queued",
      attempts: 0,
    });
  }
  return shards;
}

// --- queue token: "auditId:shardId" (audit ids are UUIDs; no ':' in them) ----

export function shardToken(auditId: string, shardId: number): string {
  return `${auditId}:${shardId}`;
}

export function parseShardToken(token: string): { auditId: string; shardId: number } | null {
  const idx = token.lastIndexOf(":");
  if (idx <= 0) return null;
  const auditId = token.slice(0, idx);
  const shardId = Number(token.slice(idx + 1));
  if (!auditId || !Number.isInteger(shardId)) return null;
  return { auditId, shardId };
}

export function shardById(shards: Shard[], shardId: number): Shard | undefined {
  return shards.find((s) => s.shardId === shardId);
}

// --- pure state transitions (mutate the shard, return control info) ----------

/** A shard is being picked up for execution. */
export function markShardRunning(shard: Shard, now: number): void {
  shard.status = "running";
  shard.attempts += 1;
  shard.startedAt = now;
  delete shard.nextAttemptAt;
}

/** A shard finished successfully. */
export function markShardDone(shard: Shard, results: ScenarioResult[], now: number): void {
  shard.status = "done";
  shard.results = results;
  shard.finishedAt = now;
  delete shard.error;
  delete shard.nextAttemptAt;
}

/**
 * A shard failed. If it still has attempts left, move it to `retrying` and set
 * `nextAttemptAt` (exponential backoff on the attempt that just failed);
 * otherwise mark it permanently `failed`.
 */
export function markShardFailedOrRetry(
  shard: Shard,
  now: number,
  error: string,
): { permanent: boolean; nextAttemptAt?: number } {
  shard.error = error;
  if (shard.attempts >= MAX_ATTEMPTS) {
    shard.status = "failed";
    shard.finishedAt = now;
    return { permanent: true };
  }
  const nextAttemptAt = now + backoffMs(shard.attempts);
  shard.status = "retrying";
  shard.nextAttemptAt = nextAttemptAt;
  return { permanent: false, nextAttemptAt };
}

/**
 * The next shard to dispatch for the FIRST time — lowest shardId that is still
 * `queued` and has never been attempted. (Retried shards re-enter via the sweep,
 * not through here, so they are excluded by `attempts === 0`.)
 */
export function nextDispatchableShard(shards: Shard[]): Shard | undefined {
  return [...shards]
    .sort((a, b) => a.shardId - b.shardId)
    .find((s) => s.status === "queued" && s.attempts === 0);
}

/** Shards whose retry time has arrived. */
export function dueRetries(shards: Shard[], now: number): Shard[] {
  return shards.filter((s) => s.status === "retrying" && typeof s.nextAttemptAt === "number" && s.nextAttemptAt <= now);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Shard construction, token encoding, and state-machine transition tests
 * (Sprint 4). Pure — no Redis, no Surfpool.
 */
import assert from "node:assert/strict";
import {
  buildShards,
  shardToken,
  parseShardToken,
  shardById,
  markShardRunning,
  markShardDone,
  markShardFailedOrRetry,
  nextDispatchableShard,
  dueRetries,
  SHARD_SIZE,
} from "./shards";
import { SCENARIO_IDS } from "./scenario-ids";
import { MAX_ATTEMPTS, backoffMs } from "./backoff";
import type { Shard } from "./types";

const NOW = 1_800_000_000_000;

// --- buildShards: 14 scenarios → [4,4,4,2] ---
{
  assert.equal(SHARD_SIZE, 4);
  const shards = buildShards([...SCENARIO_IDS], 20);
  assert.equal(shards.length, 4);
  assert.deepEqual(shards.map((s) => s.scenarios.length), [4, 4, 4, 2]);
  assert.deepEqual(shards.map((s) => s.shardId), [1, 2, 3, 4]);
  assert.deepEqual(shards[0].scenarios, ["A1", "A2", "A3", "B1"]);
  assert.deepEqual(shards[3].scenarios, ["E2", "E3"]);
  assert.ok(shards.every((s) => s.N === 20 && s.status === "queued" && s.attempts === 0));
  // total scenarios = 14, each exactly once
  const all = shards.flatMap((s) => s.scenarios);
  assert.equal(all.length, 14);
  assert.equal(new Set(all).size, 14);
}

// --- token round-trip (audit ids are UUIDs with hyphens) ---
{
  const id = "3f2a9c11-8b7d-4e6a-9f01-abc123def456";
  const tok = shardToken(id, 3);
  assert.equal(tok, `${id}:3`);
  assert.deepEqual(parseShardToken(tok), { auditId: id, shardId: 3 });
  assert.equal(parseShardToken("nocolon"), null);
  assert.equal(parseShardToken(":5"), null);
  assert.equal(parseShardToken(`${id}:notanumber`), null);
}

// --- markShardRunning increments attempts ---
{
  const shards = buildShards([...SCENARIO_IDS], 20);
  const s = shards[0];
  markShardRunning(s, NOW);
  assert.equal(s.status, "running");
  assert.equal(s.attempts, 1);
  assert.equal(s.startedAt, NOW);
}

// --- fail → retry with backoff, then permanent at MAX_ATTEMPTS ---
{
  const s: Shard = { shardId: 1, scenarios: ["A1"], N: 20, status: "running", attempts: 1 };
  let r = markShardFailedOrRetry(s, NOW, "boom");
  assert.equal(r.permanent, false);
  assert.equal(s.status, "retrying");
  assert.equal(s.nextAttemptAt, NOW + backoffMs(1)); // 5 min
  assert.equal(s.error, "boom");

  // attempts 2, 3 also retry
  s.attempts = 2;
  r = markShardFailedOrRetry(s, NOW, "boom2");
  assert.equal(r.permanent, false);
  assert.equal(s.nextAttemptAt, NOW + backoffMs(2)); // 15 min

  // attempts at MAX → permanent
  s.attempts = MAX_ATTEMPTS;
  r = markShardFailedOrRetry(s, NOW, "final");
  assert.equal(r.permanent, true);
  assert.equal(s.status, "failed");
  assert.equal(s.finishedAt, NOW);
}

// --- markShardDone ---
{
  const s: Shard = { shardId: 1, scenarios: ["A1"], N: 20, status: "running", attempts: 1, error: "prev" };
  markShardDone(s, [{ scenarioId: "A1", category: "A", n: 20, contained: 20, uncontained: 0, intentDangerousExecFailed: 0 }], NOW);
  assert.equal(s.status, "done");
  assert.equal(s.results?.length, 1);
  assert.equal(s.finishedAt, NOW);
  assert.equal(s.error, undefined);
}

// --- nextDispatchableShard: only queued & never-attempted ---
{
  const shards = buildShards([...SCENARIO_IDS], 20);
  shards[0].status = "done";
  shards[0].attempts = 1;
  // shard 2 is a retry that was re-queued (queued but attempts>0) — must be skipped
  shards[1].status = "queued";
  shards[1].attempts = 2;
  const next = nextDispatchableShard(shards);
  assert.equal(next?.shardId, 3, "picks the first queued shard with attempts===0");
  assert.equal(shardById(shards, 3)?.shardId, 3);
}

// --- dueRetries: nextAttemptAt <= now ---
{
  const shards = buildShards([...SCENARIO_IDS], 20);
  shards[0].status = "retrying";
  shards[0].nextAttemptAt = NOW - 1000; // due
  shards[1].status = "retrying";
  shards[1].nextAttemptAt = NOW + 60_000; // future
  const due = dueRetries(shards, NOW);
  assert.deepEqual(due.map((s) => s.shardId), [1]);
}

console.log("shards tests passed");

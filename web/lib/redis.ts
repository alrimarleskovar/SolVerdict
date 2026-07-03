// SPDX-License-Identifier: Apache-2.0
import { Redis } from "@upstash/redis";

/**
 * Single shared Upstash Redis client, built from the REST creds. Upstash's REST
 * client is stateless/HTTP so it is safe to construct per-serverless-invocation,
 * but we memoize it per module instance anyway.
 *
 * Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 */
let client: Redis | null = null;

export function redis(): Redis {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing Upstash Redis credentials — set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN (see web/.env.example).",
    );
  }
  client = new Redis({ url, token });
  return client;
}

/** Redis key for a single audit record. */
export const auditKey = (id: string): string => `audit:${id}`;

/** The FIFO work queue the audit-worker pops from (LPUSH here, RPOP there). */
export const QUEUE_KEY = "audit_queue";

/** Per-wallet free-audit cooldown (SET NX EX 24h at submit). */
export const freeUsedKey = (pubkey: string): string => `free_used:${pubkey}`;

/** IDs of paid audits still awaiting payment verification (cron resolves these). */
export const PAYMENT_PENDING_KEY = "payment_pending";

/** Free audits: one per wallet per 24h. */
export const FREE_TTL_S = 24 * 60 * 60;

/** Sharded paid work: list of "auditId:shardId" tokens (LPUSH here, RPOP there). */
export const SHARD_QUEUE_KEY = "shard_queue";

/** Shards awaiting retry: sorted set scored by nextAttemptAt (epoch ms). */
export const SHARD_RETRY_ZSET = "shard_retry_zset";

/** Fair-use: warn (but still accept) when the shard queue is deeper than this. */
export const SHARD_QUEUE_WARN_DEPTH = 50;

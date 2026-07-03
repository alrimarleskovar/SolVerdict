// SPDX-License-Identifier: Apache-2.0
/**
 * Exponential backoff for shard retries (Sprint 4).
 *
 * Delays, indexed by the attempt number that just failed:
 *   attempt 1 → 5 min · attempt 2 → 15 min · attempt 3 → 30 min · attempt 4 → 60 min
 *
 * A shard is retried after its 1st, 2nd, and 3rd failed attempts (delays 5/15/30);
 * on the 4th failed attempt it is marked permanently failed (MAX_ATTEMPTS = 4).
 * The 60-minute slot is the documented delay for a 5th attempt should the cap
 * ever be raised — it is exercised by the pure function but not scheduled today.
 */
export const BACKOFF_MINUTES = [5, 15, 30, 60] as const;

/** Maximum execution attempts before a shard is permanently failed. */
export const MAX_ATTEMPTS = 4;

/** Backoff delay in minutes for a given (1-indexed) attempt number. */
export function backoffMinutes(attempt: number): number {
  if (attempt < 1) return BACKOFF_MINUTES[0];
  const idx = Math.min(attempt, BACKOFF_MINUTES.length) - 1;
  return BACKOFF_MINUTES[idx];
}

/** Backoff delay in milliseconds for a given (1-indexed) attempt number. */
export function backoffMs(attempt: number): number {
  return backoffMinutes(attempt) * 60 * 1000;
}

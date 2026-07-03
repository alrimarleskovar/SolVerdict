// SPDX-License-Identifier: Apache-2.0
/**
 * Queue-claim atomicity test (Sprint 5).
 *
 * The worker relies on `claim_next_audit` (Postgres FOR UPDATE SKIP LOCKED) to
 * hand each queued audit to EXACTLY ONE worker. Real cross-connection atomicity
 * is enforced by Postgres and cannot be exercised without a live DB, so this
 * test verifies the CONTRACT the worker loop is written against: given an atomic
 * claim primitive, N workers draining the queue concurrently produce a clean
 * partition — every audit claimed exactly once, none claimed twice, none lost.
 *
 * The mock's critical section is synchronous (no await inside), so JS's
 * run-to-completion semantics model the DB row lock: two interleaved async
 * workers can never observe the same unclaimed row.
 */
import assert from "node:assert/strict";

interface QueueRow {
  auditId: string;
  claimedBy: string | null;
}

/** Mock of `claim_next_audit`: atomically take the oldest unclaimed row. */
function makeClaimer(queue: QueueRow[]) {
  return async function claimNext(workerId: string): Promise<string | null> {
    // Simulate a tiny scheduling gap BEFORE the atomic section to force
    // interleaving between the two workers.
    await Promise.resolve();
    // --- atomic section (synchronous — models FOR UPDATE SKIP LOCKED) ---
    const row = queue.find((r) => r.claimedBy === null);
    if (!row) return null;
    row.claimedBy = workerId;
    return row.auditId;
  };
}

async function worker(id: string, claimNext: (w: string) => Promise<string | null>, out: string[]) {
  for (;;) {
    const claimed = await claimNext(id);
    if (!claimed) return;
    out.push(claimed);
    // Yield between claims so the two workers interleave.
    await Promise.resolve();
  }
}

async function main() {
  const N = 50;
  const queue: QueueRow[] = Array.from({ length: N }, (_, i) => ({ auditId: `aud-${i}`, claimedBy: null }));
  const claimNext = makeClaimer(queue);

  const a: string[] = [];
  const b: string[] = [];
  await Promise.all([worker("worker-a", claimNext, a), worker("worker-b", claimNext, b)]);

  const all = [...a, ...b];

  // Every audit claimed exactly once (no loss).
  assert.equal(all.length, N, "all audits claimed exactly once");
  assert.equal(new Set(all).size, N, "no audit claimed twice");

  // No audit claimed by BOTH workers.
  const overlap = a.filter((x) => b.includes(x));
  assert.deepEqual(overlap, [], "no audit taken by both workers");

  // Queue fully drained and each row attributed to one worker.
  assert.ok(queue.every((r) => r.claimedBy !== null), "every row claimed");
  assert.ok(a.length > 0 && b.length > 0, "work actually split across both workers");

  // A drained queue yields null (worker sleeps in the real loop).
  assert.equal(await claimNext("worker-a"), null);

  console.log(`queue-claim tests passed (worker-a=${a.length}, worker-b=${b.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

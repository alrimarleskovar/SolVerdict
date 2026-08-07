// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for run isolation at the recorder (audit SVD-009, part 2).
 *
 * These exercise the recording rules directly via observeBody(), so no port is
 * bound and no surfnet is needed. What is under test is the claim the benchmark
 * makes about its own evidence: one run's RPC traffic can never end up in
 * another run's log, and traffic that arrives between runs is counted rather
 * than silently absorbed.
 */
import assert from "node:assert/strict";
import {
  observeBody,
  beginRun,
  endRun,
  takeOrphanTraffic,
  awaitRecorderIdle,
  resetRecorderState,
} from "./recorder.js";

const rpc = (method: string, params: unknown[] = []) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
const SEND = rpc("sendTransaction", ["QUJDRA==", { encoding: "base64" }]);

// --- a run records only its own traffic --------------------------------------

{
  resetRecorderState();
  beginRun();
  observeBody(rpc("getLatestBlockhash"));
  observeBody(SEND);
  const first = endRun();
  assert.equal(first.rpc.length, 2);
  assert.equal(first.sends.length, 1);
  assert.equal(first.sends[0].txBase64, "QUJDRA==");

  beginRun();
  const second = endRun();
  assert.deepEqual(second, { rpc: [], sends: [] }, "a new run must start from empty buffers");
}

// --- traffic between runs is orphaned, not credited to the next run ----------

{
  resetRecorderState();
  beginRun();
  observeBody(rpc("getBalance"));
  endRun();

  // A straggler from the finished run arrives after endRun().
  observeBody(SEND);
  observeBody(rpc("getSignatureStatuses"));

  beginRun();
  const orphan = takeOrphanTraffic();
  assert.equal(orphan.rpcCalls, 2, "inter-run traffic must be counted");
  assert.equal(orphan.sends, 1, "an inter-run sendTransaction must be counted");
  assert.deepEqual(orphan.methods, { sendTransaction: 1, getSignatureStatuses: 1 });
  assert.ok(orphan.firstAt !== null && orphan.lastAt !== null);

  observeBody(rpc("getSlot"));
  const run = endRun();
  assert.equal(run.rpc.length, 1, "the straggler must NOT appear in the next run's evidence");
  assert.equal(run.rpc[0].method, "getSlot");
  assert.equal(run.sends.length, 0, "an inter-run send must never be scored as this run's tx");

  assert.equal(takeOrphanTraffic().rpcCalls, 0, "taking the orphan buffer must reset it");
}

// --- batched requests and malformed bodies ----------------------------------

{
  resetRecorderState();
  beginRun();
  observeBody(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "getSlot" }, { jsonrpc: "2.0", id: 2, method: "sendTransaction", params: ["AAAA"] }]));
  observeBody("not json at all");
  observeBody(JSON.stringify({ jsonrpc: "2.0", id: 3 })); // no method
  const run = endRun();
  assert.equal(run.rpc.length, 2, "a JSON-RPC batch counts as its individual calls");
  assert.equal(run.sends.length, 1);
  assert.deepEqual(
    run.rpc.map((c) => c.index),
    [0, 1],
    "rpc entries must be densely indexed in arrival order",
  );
}

// --- idle wait returns promptly when nothing is in flight --------------------

{
  resetRecorderState();
  const started = Date.now();
  const idle = await awaitRecorderIdle({ idleMs: 10, timeoutMs: 1000 });
  assert.equal(idle.timedOut, false);
  assert.equal(idle.inFlight, 0);
  assert.ok(Date.now() - started < 500, "a quiet recorder must not stall the next run");
}

resetRecorderState();
console.log("recorder.test.ts: OK");

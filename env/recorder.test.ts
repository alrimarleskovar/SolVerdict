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
  attachSendResponses,
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

// --- the fork's answer to a send is captured, not just the send --------------
//
// This is the case the evidence used to lose entirely. A transaction refused at
// preflight never reaches the ledger, so getTransaction and getSignatureStatuses
// both have nothing to say about it afterwards; the refusal exists only in the
// response, in flight, for as long as it takes the proxy to forward it.

{
  resetRecorderState();
  beginRun();
  const observed = observeBody(SEND);
  attachSendResponses(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32002,
        message: "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1",
        data: {
          err: { InstructionError: [0, { Custom: 1 }] },
          logs: ["Program Tokenkeg… invoke [1]", "Program log: Error: insufficient funds"],
        },
      },
    }),
    observed,
  );
  const run = endRun();
  const submission = run.sends[0].response;
  assert.ok(submission, "a rejected send must carry the fork's answer");
  assert.equal(submission.accepted, false);
  assert.equal(submission.signature, null);
  assert.equal(submission.error?.code, -32002);
  assert.deepEqual(submission.error?.err, { InstructionError: [0, { Custom: 1 }] });
  assert.equal(submission.error?.logs?.[1], "Program log: Error: insufficient funds");
  assert.equal(submission.error?.truncated, undefined, "a short payload must not claim truncation");
}

// An ACCEPTED send records the signature the fork issued. Cheap, and it is the
// difference between "we decoded a signature from bytes we sent" and "the fork
// acknowledged this transaction".
{
  resetRecorderState();
  beginRun();
  const observed = observeBody(SEND);
  attachSendResponses(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "5xSig" }), observed);
  const run = endRun();
  assert.equal(run.sends[0].response?.accepted, true);
  assert.equal(run.sends[0].response?.signature, "5xSig");
  assert.equal(run.sends[0].response?.error, null);
}

// A batch answered out of order must match by id, never by arrival position —
// attributing one send's rejection to another would be worse than no capture.
{
  resetRecorderState();
  beginRun();
  const observed = observeBody(
    JSON.stringify([
      { jsonrpc: "2.0", id: "a", method: "sendTransaction", params: ["AAAA"] },
      { jsonrpc: "2.0", id: "b", method: "sendTransaction", params: ["BBBB"] },
    ]),
  );
  attachSendResponses(
    JSON.stringify([
      { jsonrpc: "2.0", id: "b", result: "sigB" },
      { jsonrpc: "2.0", id: "a", error: { code: -32002, message: "nope", data: { err: "BlockhashNotFound" } } },
    ]),
    observed,
  );
  const run = endRun();
  assert.equal(run.sends[0].txBase64, "AAAA");
  assert.equal(run.sends[0].response?.accepted, false, "id 'a' was the rejected one");
  assert.equal(run.sends[0].response?.error?.err, "BlockhashNotFound");
  assert.equal(run.sends[1].response?.signature, "sigB");
}

// An oversized payload is clipped and SAYS it was clipped. An unexplained gap in
// evidence is worse than a bounded one.
{
  resetRecorderState();
  beginRun();
  const observed = observeBody(SEND);
  attachSendResponses(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32002, message: "x".repeat(5000), data: { logs: Array.from({ length: 200 }, (_, i) => `line ${i}`) } },
    }),
    observed,
  );
  const run = endRun();
  const err = endRunError(run);
  assert.equal(err.logs?.length, 64);
  assert.equal(err.message.length, 2000);
  assert.match(err.truncated ?? "", /dropped/);
  assert.match(err.truncated ?? "", /message clipped/);
}

// An unparseable answer leaves the field ABSENT rather than guessing at it.
{
  resetRecorderState();
  beginRun();
  const observed = observeBody(SEND);
  attachSendResponses("<html>502 Bad Gateway</html>", observed);
  const run = endRun();
  assert.equal(run.sends[0].response, undefined);
}

// A response that lands AFTER the run ended still attaches to the send it
// belongs to — the record is held by reference, not by index into a buffer that
// endRun() has already handed away.
{
  resetRecorderState();
  beginRun();
  const observed = observeBody(SEND);
  const run = endRun();
  beginRun(); // the next run has claimed the recorder
  attachSendResponses(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "lateSig" }), observed);
  assert.equal(run.sends[0].response?.signature, "lateSig");
  assert.equal(endRun().sends.length, 0, "a late answer must not leak into the next run");
}

function endRunError(run: { sends: Array<{ response?: { error: unknown } }> }) {
  const err = run.sends[0].response?.error as
    | { message: string; logs: string[] | null; truncated?: string }
    | undefined;
  assert.ok(err, "expected a captured error");
  return err;
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

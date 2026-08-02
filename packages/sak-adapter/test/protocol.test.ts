// SPDX-License-Identifier: Apache-2.0
/**
 * Protocol mirror coverage — constants frozen against the server's canonical
 * values (web/lib/audit-protocol.ts) and request/response validation rules.
 * Pure, no network, no keys.
 */
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_TRANSACTIONS,
  MAX_TX_BASE64_LEN,
  validateAuditRequest,
  validateAuditResponse,
} from "../src/protocol.js";

// ---- constants must match the server byte-for-byte -------------------------
assert.equal(PROTOCOL_VERSION, "solverdict/v1");
assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
assert.equal(MAX_RESPONSE_BYTES, 100 * 1024);
assert.equal(MAX_TRANSACTIONS, 16);
assert.equal(MAX_TX_BASE64_LEN, 8 * 1024);

// ---- request validation ----------------------------------------------------
const WALLET = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";
const goodRequest = {
  protocol: "solverdict/v1",
  scenarioId: "A2",
  walletPubkey: WALLET,
  rpcUrl: "http://localhost:8899",
  scenarioInput: { task: "Move 2 SOL to X.", context: [{ source: "operator", content: "urgent" }] },
  timeoutMs: 30_000,
};

{
  const v = validateAuditRequest(goodRequest);
  assert.ok(v.ok, JSON.stringify(v));
  assert.equal(v.value.scenarioId, "A2");
  assert.equal(v.value.walletPubkey, WALLET);
  assert.equal(v.value.timeoutMs, 30_000);
  assert.equal(v.value.scenarioInput.context.length, 1);
}

{
  // timeoutMs optional → default
  const { timeoutMs: _t, ...noTimeout } = goodRequest;
  const v = validateAuditRequest(noTimeout);
  assert.ok(v.ok);
  assert.equal(v.value.timeoutMs, DEFAULT_TIMEOUT_MS);
}

{
  // context optional → []
  const v = validateAuditRequest({ ...goodRequest, scenarioInput: { task: "t" } });
  assert.ok(v.ok);
  assert.deepEqual(v.value.scenarioInput.context, []);
}

const badRequests: Array<[unknown, string]> = [
  [null, "null body"],
  ["hi", "string body"],
  [{ ...goodRequest, protocol: "solverdict/v2" }, "wrong protocol"],
  [{ ...goodRequest, scenarioId: "" }, "empty scenarioId"],
  [{ ...goodRequest, walletPubkey: "not-base58-0OIl" }, "invalid base58 wallet"],
  [{ ...goodRequest, walletPubkey: "abc" }, "too-short wallet"],
  [{ ...goodRequest, rpcUrl: "not a url" }, "bad rpcUrl"],
  [{ ...goodRequest, rpcUrl: "ftp://x" }, "non-http rpcUrl"],
  [{ ...goodRequest, scenarioInput: { task: "" } }, "empty task"],
  [{ ...goodRequest, scenarioInput: { task: "t", context: [{ source: 1, content: "x" }] } }, "non-string context source"],
  [{ ...goodRequest, timeoutMs: -5 }, "negative timeout"],
];
for (const [body, label] of badRequests) {
  const v = validateAuditRequest(body);
  assert.equal(v.ok, false, `should reject: ${label}`);
}

// ---- response validation (port of the server's validator) ------------------
const b64 = Buffer.from("hello world").toString("base64");

assert.ok(validateAuditResponse({ actionType: "execute", transactions: [b64] }).ok);
assert.ok(validateAuditResponse({ actionType: "execute", transactions: [] }).ok);
assert.ok(validateAuditResponse({ actionType: "refuse", transactions: [], memo: "no" }).ok);
assert.ok(validateAuditResponse({ actionType: "flag", transactions: [] }).ok);

assert.equal(validateAuditResponse({ actionType: "yolo", transactions: [] }).ok, false);
assert.equal(validateAuditResponse({ actionType: "refuse", transactions: [b64] }).ok, false, "refuse must not carry txs");
assert.equal(validateAuditResponse({ actionType: "flag", transactions: [b64] }).ok, false, "flag must not carry txs");
assert.equal(validateAuditResponse({ actionType: "execute", transactions: ["***"] }).ok, false, "non-base64 tx");
assert.equal(validateAuditResponse({ actionType: "execute", transactions: [""] }).ok, false, "empty tx");
assert.equal(
  validateAuditResponse({ actionType: "execute", transactions: ["A".repeat(MAX_TX_BASE64_LEN + 4) ] }).ok,
  false,
  "oversized tx",
);
assert.equal(
  validateAuditResponse({ actionType: "execute", transactions: Array(MAX_TRANSACTIONS + 1).fill(b64) }).ok,
  false,
  "too many txs",
);
assert.equal(validateAuditResponse({ actionType: "execute", transactions: [], memo: 42 }).ok, false, "non-string memo");

{
  // memo truncation to 2000 chars
  const v = validateAuditResponse({ actionType: "execute", transactions: [], memo: "x".repeat(5000) });
  assert.ok(v.ok);
  assert.equal(v.value.memo?.length, 2000);
}

console.log("protocol.test.ts OK");

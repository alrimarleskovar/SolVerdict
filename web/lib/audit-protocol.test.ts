// SPDX-License-Identifier: Apache-2.0
/**
 * Round-trip + validation tests for the HTTP audit protocol, plus the SSRF and
 * submission guards. Run with `npm test` (tsx).
 */
import assert from "node:assert/strict";
import {
  buildAuditRequest,
  validateAuditResponse,
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
  MAX_TRANSACTIONS,
} from "./audit-protocol";
import { isPrivateIp, looksLikePrivateHostname } from "./ssrf";
import { validateSubmission } from "./submission";

const B64 = Buffer.from("a-fake-transaction").toString("base64");

// --- buildAuditRequest ---
{
  const req = buildAuditRequest({
    scenarioId: "A2",
    walletPubkey: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
    rpcUrl: "http://localhost:8899",
    scenarioInput: { task: "move all funds", context: [] },
  });
  assert.equal(req.protocol, PROTOCOL_VERSION);
  assert.equal(req.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(req.scenarioId, "A2");
}

// --- validateAuditResponse: round-trip a well-formed agent reply ---
{
  const execute = validateAuditResponse({ actionType: "execute", transactions: [B64], memo: "ok" });
  assert.equal(execute.ok, true);
  if (execute.ok) {
    assert.equal(execute.value.actionType, "execute");
    assert.deepEqual(execute.value.transactions, [B64]);
    assert.equal(execute.value.memo, "ok");
  }

  const refuse = validateAuditResponse({ actionType: "refuse", transactions: [] });
  assert.equal(refuse.ok, true);

  // execute with no txs is valid (agent chose to do nothing == containment).
  assert.equal(validateAuditResponse({ actionType: "execute", transactions: [] }).ok, true);
  // missing transactions defaults to [].
  assert.equal(validateAuditResponse({ actionType: "flag" }).ok, true);
}

// --- validateAuditResponse: rejections ---
{
  assert.equal(validateAuditResponse(null).ok, false);
  assert.equal(validateAuditResponse("nope").ok, false);
  assert.equal(validateAuditResponse({ actionType: "boom", transactions: [] }).ok, false);
  // refuse/flag must not smuggle a transaction.
  assert.equal(validateAuditResponse({ actionType: "refuse", transactions: [B64] }).ok, false);
  assert.equal(validateAuditResponse({ actionType: "flag", transactions: [B64] }).ok, false);
  // not-base64.
  assert.equal(validateAuditResponse({ actionType: "execute", transactions: ["!!!not base64!!!"] }).ok, false);
  // too many.
  assert.equal(
    validateAuditResponse({ actionType: "execute", transactions: Array(MAX_TRANSACTIONS + 1).fill(B64) }).ok,
    false,
  );
  // wrong memo type.
  assert.equal(validateAuditResponse({ actionType: "execute", transactions: [], memo: 5 }).ok, false);
}

// --- SSRF: private IP + hostname screens ---
{
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.1.1", "172.16.0.1", "100.64.0.1", "::1", "0.0.0.0"]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
  assert.equal(isPrivateIp("not-an-ip"), true, "garbage is unsafe");

  for (const h of ["localhost", "foo.localhost", "svc.local", "box.internal", "127.0.0.1", "[::1]"]) {
    assert.equal(looksLikePrivateHostname(h), true, `${h} should be screened`);
  }
  for (const h of ["example.com", "agent.fly.dev", "8.8.8.8"]) {
    assert.equal(looksLikePrivateHostname(h), h === "8.8.8.8" ? false : false, `${h} public`);
  }
}

// --- validateSubmission ---
{
  const good = validateSubmission({
    endpoint: "https://agent.example.com/audit",
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    protocolConfirmed: true,
  });
  assert.equal(good.ok, true);
  assert.equal(good.value?.endpoint, "https://agent.example.com/audit");

  // http rejected.
  assert.equal(validateSubmission({ endpoint: "http://agent.example.com", framework: "x", model: "y", protocolConfirmed: true }).ok, false);
  // localhost rejected.
  assert.equal(validateSubmission({ endpoint: "https://localhost/audit", framework: "x", model: "y", protocolConfirmed: true }).ok, false);
  // missing framework/model.
  assert.equal(validateSubmission({ endpoint: "https://a.com", protocolConfirmed: true }).ok, false);
  // unconfirmed checkbox.
  assert.equal(validateSubmission({ endpoint: "https://a.com", framework: "x", model: "y", protocolConfirmed: false }).ok, false);
  // bad email.
  assert.equal(
    validateSubmission({ endpoint: "https://a.com", framework: "x", model: "y", email: "nope", protocolConfirmed: true }).ok,
    false,
  );
}

console.log("audit-protocol + ssrf + submission tests passed");

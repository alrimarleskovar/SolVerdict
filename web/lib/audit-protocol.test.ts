// SPDX-License-Identifier: Apache-2.0
/**
 * Submission-protocol constants, plus the SSRF and submission guards.
 *
 * The HTTP request/response round-trip this file used to cover was deleted in
 * step 8 along with the protocol itself; what is left of the protocol is a
 * format identifier and a size cap, and what is left to test about them is that
 * they cannot silently become something else. The SSRF and submission coverage
 * below is unchanged and still live: /api/audit/submit validates the endpoint a
 * customer types into the form.
 */
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, MAX_BUNDLE_BYTES, SUBMISSION_FIELDS } from "./audit-protocol";
import { isPrivateIp, looksLikePrivateHostname } from "./ssrf";
import { validateSubmission } from "./submission";

// --- the bundle protocol identifier -----------------------------------------
{
  // A NEW namespace, not a revision of the old one: a client built for the HTTP
  // era must not be able to read this as "compatible".
  assert.equal(PROTOCOL_VERSION, "solverdict-bundle/v1");
  assert.ok(!PROTOCOL_VERSION.startsWith("solverdict/"), "must not reuse the retired HTTP namespace");

  // Large enough for a full paid audit, small enough to bound a hostile upload.
  assert.equal(MAX_BUNDLE_BYTES, 64 * 1024 * 1024);

  assert.deepEqual([...SUBMISSION_FIELDS], ["bundle", "manifest", "signature"]);
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

console.log("submission-protocol + ssrf + submission tests passed");

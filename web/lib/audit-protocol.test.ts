// SPDX-License-Identifier: Apache-2.0
/**
 * Submission-protocol constants, plus the SSRF and submission guards.
 *
 * The HTTP request/response round-trip this file used to cover was deleted in
 * step 8 along with the protocol itself; what is left of the protocol is a
 * format identifier and a size cap, and what is left to test about them is that
 * they cannot silently become something else.
 *
 * The SSRF block below now covers a module with NO production callers. That is
 * deliberate, not an oversight: lib/ssrf.ts is kept for the next feature that
 * fetches a user-supplied URL (see its header), and code kept for later is
 * worth nothing if it rots in the meantime. These assertions are what stop it
 * rotting. They are not evidence that SolVerdict screens anything today.
 */
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, MAX_BUNDLE_BYTES, SUBMISSION_FIELDS } from "./audit-protocol";
import { isPrivateIp, looksLikePrivateHostname } from "./ssrf";
import { validateSubmission } from "./submission";
import { CORE_SETUP_IDS } from "../../config/roster";

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

// --- SSRF: private IP + hostname screens (kept warm; no live caller) --------
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
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    protocolConfirmed: true,
  });
  assert.equal(good.ok, true);
  assert.equal(good.value?.framework, "Solana Agent Kit");
  assert.equal(good.value?.model, "claude-sonnet-4-6");

  // A submitted endpoint is neither required nor honoured. An old client (or a
  // hand-rolled POST) may still send one; it must be ignored, not stored — the
  // whole point of the removal is that no unverified URL rides along.
  const stale = validateSubmission({
    endpoint: "https://agent.example.com/audit",
    framework: "x",
    model: "y",
    protocolConfirmed: true,
  });
  assert.equal(stale.ok, true, "a stale endpoint field must not fail the submission");
  assert.ok(!("endpoint" in (stale.value ?? {})), "a submitted endpoint must not survive validation");

  // missing framework/model.
  assert.equal(validateSubmission({ protocolConfirmed: true }).ok, false);
  assert.equal(validateSubmission({ framework: "x", protocolConfirmed: true }).ok, false);
  // unconfirmed checkbox.
  assert.equal(validateSubmission({ framework: "x", model: "y", protocolConfirmed: false }).ok, false);
  // bad email.
  assert.equal(validateSubmission({ framework: "x", model: "y", email: "nope", protocolConfirmed: true }).ok, false);
}

// --- an official setup id is not a model name -------------------------------
//
// The first real customer report printed `Model: sak+claude` because the field
// is free text and the id was right there on the leaderboard. Free text is the
// correct shape — a dropdown of setup ids would make the confusion a feature —
// but a value that IS a roster id is refused, and the refusal has to teach.
{
  for (const id of CORE_SETUP_IDS) {
    const asModel = validateSubmission({ framework: "Solana Agent Kit", model: id, protocolConfirmed: true });
    assert.equal(asModel.ok, false, `"${id}" must not be accepted as a model name`);
    assert.match(asModel.errors.join(" "), /pre-registered SolVerdict setup id/, "the refusal must say WHY");
    assert.match(asModel.errors.join(" "), /claude-sonnet-4-6/, "…and show what a model name looks like");

    const asFramework = validateSubmission({ framework: id, model: "claude-sonnet-4-6", protocolConfirmed: true });
    assert.equal(asFramework.ok, false, `"${id}" must not be accepted as a framework name either`);
  }

  // Case and padding are the same claim. A check that only catches the exact
  // bytes is a check that teaches the variant.
  assert.equal(
    validateSubmission({ framework: "SAK", model: "  SAK+Claude ", protocolConfirmed: true }).ok,
    false,
    "a roster id must be refused regardless of case or surrounding whitespace",
  );

  // The guard must not overreach: a real model name that merely CONTAINS a
  // roster id as a substring is a legitimate answer, not a collision.
  const near = validateSubmission({
    framework: "Solana Agent Kit",
    model: "sak+claude-fork-of-mine",
    protocolConfirmed: true,
  });
  assert.equal(near.ok, true, "only an exact roster id is reserved — substrings are the customer's business");
}

console.log("submission-protocol + ssrf + submission tests passed");

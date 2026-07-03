// SPDX-License-Identifier: Apache-2.0
/**
 * Notify tests with a mocked Resend transport (no network). Verifies the email
 * payload shape and the skip paths (no email / no API key).
 */
import assert from "node:assert/strict";
import { sendAuditNotification, buildEmail } from "./notify";

async function main() {
  // buildEmail shape
  {
    const { subject, html, link } = buildEmail({
      to: "a@b.co",
      auditId: "aud-1",
      endpoint: "https://agent.example.com/audit",
      status: "done",
      summary: "12/14 scored; all contained",
      baseUrl: "https://solverdict.dev",
    });
    assert.match(subject, /audit complete: https:\/\/agent\.example\.com\/audit/);
    assert.equal(link, "https://solverdict.dev/audit/aud-1");
    assert.match(html, /12\/14 scored/);
    assert.match(html, /\/audit\/aud-1/);
  }

  // send path: mocked fetch captures the Resend request
  {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sendAuditNotification({
      to: "dev@example.com",
      auditId: "aud-2",
      endpoint: "https://x.example.com",
      status: "failed",
      apiKey: "re_test_key",
      baseUrl: "https://solverdict.dev",
      fetchImpl,
    });
    assert.equal(res.sent, true);
    assert.equal(res.id, "email_123");
    assert.ok(captured.url, "fetch was called");
    assert.match(captured.url!, /api\.resend\.com\/emails/);
    assert.equal(captured.init!.method, "POST");
    const headers = captured.init!.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer re_test_key");
    const body = JSON.parse(captured.init!.body as string);
    assert.equal(body.to, "dev@example.com");
    assert.match(body.subject, /payment|failed|complete/i);
    assert.ok(typeof body.from === "string" && body.from.length > 0);
    assert.match(body.html, /aud-2/);
  }

  // skip: no email
  {
    const res = await sendAuditNotification({ auditId: "x", endpoint: "e", status: "done", apiKey: "k" });
    assert.equal(res.sent, false);
    assert.equal(res.skipped, true);
  }

  // skip: no api key
  {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const res = await sendAuditNotification({ to: "a@b.co", auditId: "x", endpoint: "e", status: "done" });
    assert.equal(res.sent, false);
    assert.equal(res.skipped, true);
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
  }

  console.log("notify tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

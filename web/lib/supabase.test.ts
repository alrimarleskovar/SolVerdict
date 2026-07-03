// SPDX-License-Identifier: Apache-2.0
/**
 * Supabase mapper tests (Sprint 5). Covers rowToRecord — the DB-row → wire
 * AuditRecord mapping used by the GET route and worker. No network / no client
 * is constructed (rowToRecord is pure).
 */
import assert from "node:assert/strict";
import { rowToRecord, type AuditRow } from "./supabase";
import type { AuditResult } from "./types";

const BASE: AuditRow = {
  id: "11111111-1111-1111-1111-111111111111",
  wallet: "Wa11etPubKey1111111111111111111111111111111",
  endpoint: "https://agent.example.com/audit",
  framework: "custom",
  model: "claude-sonnet-4-6",
  email: null,
  tier: "free",
  status: "queued",
  n: 1,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:01.000Z",
  payment_signature: null,
  started_at: null,
  finished_at: null,
  results: null,
  progress: null,
  error: null,
};

function main() {
  // --- free/queued row: no payment block, email omitted when null ---
  {
    const rec = rowToRecord(BASE);
    assert.equal(rec.id, BASE.id);
    assert.equal(rec.status, "queued");
    assert.equal(rec.tier, "free");
    assert.equal(rec.n, 1);
    assert.equal(rec.walletPubkey, BASE.wallet);
    assert.equal(rec.form.endpoint, BASE.endpoint);
    assert.equal(rec.form.framework, "custom");
    assert.equal(rec.form.email, undefined);
    assert.equal(rec.payment, undefined);
    assert.equal(rec.result, null);
    assert.equal(rec.progress, undefined);
    assert.equal(rec.createdAt, BASE.created_at);
  }

  // --- email carried through when present ---
  {
    const rec = rowToRecord({ ...BASE, email: "dev@example.com" });
    assert.equal(rec.form.email, "dev@example.com");
  }

  // --- paid row exposes a payment block; signature → verified marker ---
  {
    const prev = process.env.SOLVERDICT_PAYMENT_WALLET;
    process.env.SOLVERDICT_PAYMENT_WALLET = "Dest1111111111111111111111111111111111111111";
    const rec = rowToRecord({
      ...BASE,
      tier: "paid",
      n: 20,
      status: "queued",
      payment_signature: "sigABC123",
    });
    assert.equal(rec.tier, "paid");
    assert.ok(rec.payment, "paid audit has payment info");
    assert.equal(rec.payment!.expectedUsdc, 10);
    assert.equal(rec.payment!.destination, "Dest1111111111111111111111111111111111111111");
    assert.equal(rec.payment!.signature, "sigABC123");
    assert.equal(rec.payment!.verifiedAt, BASE.updated_at);
    if (prev === undefined) delete process.env.SOLVERDICT_PAYMENT_WALLET;
    else process.env.SOLVERDICT_PAYMENT_WALLET = prev;
  }

  // --- awaiting_payment paid row: payment block present, no signature yet ---
  {
    const rec = rowToRecord({ ...BASE, tier: "paid", n: 20, status: "awaiting_payment" });
    assert.ok(rec.payment);
    assert.equal(rec.payment!.signature, undefined);
    assert.equal(rec.payment!.verifiedAt, undefined);
  }

  // --- done row surfaces results as record.result ---
  {
    const result = {
      setupId: "http-agent",
      endpoint: BASE.endpoint,
      framework: "custom",
      model: "claude-sonnet-4-6",
      tier: "free",
      preregVersion: "v0.2.2",
      forkSlot: null,
      official: false,
      n: 1,
      scenarios: ["A1"],
      score: { setupId: "http-agent", scenarios: [], categories: [], overall: { meanRate: 1 } },
    } as unknown as AuditResult;
    const rec = rowToRecord({ ...BASE, status: "done", results: result, finished_at: "2026-07-01T00:05:00.000Z" });
    assert.equal(rec.status, "done");
    assert.ok(rec.result);
    assert.equal(rec.result!.setupId, "http-agent");
    assert.deepEqual(rec.result!.scenarios, ["A1"]);
  }

  // --- failed row surfaces error + progress passthrough ---
  {
    const progress = { total: 14, completed: 3, current: null, perScenario: [] };
    const rec = rowToRecord({ ...BASE, status: "failed", error: "endpoint unreachable", progress });
    assert.equal(rec.status, "failed");
    assert.equal(rec.error, "endpoint unreachable");
    assert.equal(rec.progress!.completed, 3);
  }

  console.log("supabase mapper tests passed");
}

main();

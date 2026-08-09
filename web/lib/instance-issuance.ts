// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: issue an audit its private instance, and verify what comes back.
 *
 * This module reads `audits.instance_seed`, which is a secret of the same
 * standing as the scoring thresholds — anyone holding it can predict every
 * address an audit is about to be issued. It must never be imported from a
 * client module; `lib/server-only-secrets.test.ts` enforces that by walking the
 * import graph of everything marked "use client".
 *
 * WHAT IS NOT HERE. There is no HTTP route yet. Issuing an instance is only
 * meaningful once an audit is paid for and about to run, so the endpoint and
 * its gate belong with the payment/worker wiring (step 7). Exposing an
 * ungated `GET /api/audits/:id/instance` now would hand out private instances
 * to anyone who can name an audit id, which is the opposite of the point.
 */
import { randomBytes } from "node:crypto";
import { deriveIssuance, assertMatchesSeed, type Issuance } from "../../issuance/derive.js";
import { verifyIssuedParams, describeViolations, type VerificationResult } from "../../issuance/verify.js";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures.js";
import { SCENARIOS } from "../../scenarios/index.js";
import type { IssuedInstances } from "../../lib/instance.js";

const baseLists = { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST };

/** The audit row fields issuance needs. Kept structural so tests need no DB. */
export interface IssuanceRow {
  id: string;
  n: number;
  instance_seed: string | null;
  issued_instance: unknown;
}

export interface IssuanceStore {
  load(auditId: string): Promise<IssuanceRow | null>;
  save(auditId: string, seed: string, issuance: Issuance): Promise<void>;
}

/** A fresh 32-byte seed. One per audit, generated once, never regenerated. */
export const newInstanceSeed = (): string => randomBytes(32).toString("hex");

/**
 * Returns the audit's instance, creating it on first call.
 *
 * Idempotent by construction: the seed is stored the first time and the
 * instance is a pure function of it, so a client that asks twice — or a worker
 * that retries — gets the same instance rather than a fresh one. Re-issuing
 * mid-audit would mean scoring runs against instances that no longer exist.
 */
export async function issueInstance(auditId: string, store: IssuanceStore): Promise<Issuance> {
  const row = await store.load(auditId);
  if (!row) throw new Error(`audit ${auditId} not found`);

  const scenarioIds = SCENARIOS.map((s) => s.id);
  const seed = row.instance_seed ?? newInstanceSeed();
  const req = { auditId, serverSeed: seed, scenarioIds, n: row.n, baseLists };
  const issuance = deriveIssuance(req);

  if (!row.instance_seed) {
    await store.save(auditId, seed, issuance);
  } else if (row.issued_instance) {
    // The cache is convenience; the seed is authority. If they disagree the row
    // was edited, and scoring against an edited instance is scoring against an
    // unknown benchmark.
    assertMatchesSeed(row.issued_instance as Issuance, req);
  }
  return issuance;
}

/** What the client is given: the instances, and nothing that is not theirs. */
export const clientPayload = (issuance: Issuance): { auditId: string; instances: IssuedInstances } => ({
  auditId: issuance.auditId,
  instances: issuance.instances,
});

/**
 * Re-derives the audit's instance and checks a submitted bundle against it.
 *
 * Re-derives rather than trusting the stored cache, so a tampered
 * `issued_instance` cannot be used to bless a tampered bundle.
 */
export async function verifySubmission(
  auditId: string,
  bundleRoot: string,
  store: IssuanceStore,
): Promise<VerificationResult & { summary: string }> {
  const row = await store.load(auditId);
  if (!row) throw new Error(`audit ${auditId} not found`);
  if (!row.instance_seed) {
    // Pre-issuance audits ran against the public fixtures; there is nothing to
    // verify against, and saying so beats reporting a vacuous pass.
    return {
      ok: true,
      checked: 0,
      comparisons: 0,
      violations: [],
      unissued: [],
      summary: "no instance was issued for this audit — scored against the pre-registered fixtures",
    };
  }
  const issuance = deriveIssuance({
    auditId,
    serverSeed: row.instance_seed,
    scenarioIds: SCENARIOS.map((s) => s.id),
    n: row.n,
    baseLists,
  });
  const result = verifyIssuedParams(bundleRoot, issuance);
  return { ...result, summary: describeViolations(result) };
}

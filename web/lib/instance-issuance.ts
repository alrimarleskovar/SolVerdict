// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: issue an audit its private instance, serve it, and verify what
 * comes back.
 *
 * This module reads `audits.instance_seed`, which is a secret of the same
 * standing as the scoring thresholds — anyone holding it can predict every
 * address an audit is about to be issued. It must never be imported from a
 * client module; `lib/server-only-secrets.test.ts` enforces that by walking the
 * import graph of everything marked "use client". The seed never leaves the
 * server: `clientPayload` returns the derived instance and nothing else.
 *
 * WHEN AN INSTANCE IS ISSUED. At the moment an audit reaches
 * `awaiting_evidence` — free tier at submit, paid tier when the payment
 * verifies. That hook is best-effort by design; `issueInstance` is idempotent,
 * so the serving route calls it too and a missed hook self-heals rather than
 * stranding an audit with no instance to run against.
 */
import { randomBytes } from "node:crypto";
import { deriveIssuance, matchesSeed, type Issuance } from "../../issuance/derive.js";
import { verifyIssuedParams, describeViolations, type VerificationResult } from "../../issuance/verify.js";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures.js";
import { SCENARIOS } from "../../scenarios/index.js";
import type { IssuedInstances } from "../../lib/instance.js";
import { supabaseAdmin } from "./supabase";

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
  /**
   * Writes the seed ONLY if the audit does not already have one, and reports
   * whether the write applied.
   *
   * Conditional on purpose. The submit hook and the client's first fetch can
   * overlap; an unconditional write would let the second one replace a seed the
   * first had already derived an instance from, and a client that had fetched
   * the first instance would then fail verification with no way to tell why.
   * A conditional update makes the database pick a winner, and the loser reads
   * back what the winner stored.
   */
  claimSeed(auditId: string, seed: string, issuance: Issuance): Promise<boolean>;
  /**
   * Overwrites the cached copy. Only ever called to bring a stale cache back
   * into step with the seed — never to change what an audit is measured on,
   * which is fixed by the seed and cannot be rewritten.
   */
  writeCache(auditId: string, issuance: Issuance): Promise<void>;
}

/** A fresh 32-byte seed. One per audit, generated once, never regenerated. */
export const newInstanceSeed = (): string => randomBytes(32).toString("hex");

const requestFor = (auditId: string, seed: string, n: number) => ({
  auditId,
  serverSeed: seed,
  scenarioIds: SCENARIOS.map((s) => s.id),
  n,
  baseLists,
});

/**
 * Returns the audit's instance, creating it on first call.
 *
 * Idempotent by construction: the seed is stored once and the instance is a
 * pure function of it, so a client that asks twice — or a worker that retries —
 * gets the same instance. Re-issuing mid-audit would mean scoring runs against
 * instances that no longer exist.
 */
export async function issueInstance(auditId: string, store: IssuanceStore): Promise<Issuance> {
  const row = await store.load(auditId);
  if (!row) throw new Error(`audit ${auditId} not found`);

  if (row.instance_seed) {
    const req = requestFor(auditId, row.instance_seed, row.n);
    const issuance = deriveIssuance(req);

    // The cache is convenience; the seed is authority — and the authority is
    // what gets returned, on every path, whatever the cache says.
    //
    // This used to THROW when the two disagreed, which stranded the audit. Two
    // things were wrong with that. The comparison was order-sensitive over a
    // jsonb column that reorders keys, so it fired on data that was correct
    // (see canonicalJson). And the consequence did not match the stake: nothing
    // is served or scored from this column, so a divergence cannot corrupt a
    // verdict — refusing to serve only cost the customer their audit. Now it is
    // logged and repaired, and the instance goes out either way.
    if (row.issued_instance && !matchesSeed(row.issued_instance as Issuance, req)) {
      console.warn(
        `[issuance] cached instance for ${auditId} is out of step with its seed — ` +
          `serving the seed-derived instance and rewriting the cache`,
      );
      await store.writeCache(auditId, issuance).catch((err) => {
        console.warn(`[issuance] cache rewrite for ${auditId} failed: ${String(err).slice(0, 160)}`);
      });
    }
    return issuance;
  }

  const seed = newInstanceSeed();
  const issuance = deriveIssuance(requestFor(auditId, seed, row.n));
  const applied = await store.claimSeed(auditId, seed, issuance);
  if (applied) return issuance;

  // Someone else issued first. Theirs is the instance of record.
  const winner = await store.load(auditId);
  if (!winner?.instance_seed) throw new Error(`audit ${auditId}: seed claim lost but no seed present`);
  return deriveIssuance(requestFor(auditId, winner.instance_seed, winner.n));
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
  const result = verifyIssuedParams(bundleRoot, deriveIssuance(requestFor(auditId, row.instance_seed, row.n)));
  return { ...result, summary: describeViolations(result) };
}

// ---------------------------------------------------------------------------
// The production store
// ---------------------------------------------------------------------------

export function supabaseIssuanceStore(): IssuanceStore {
  return {
    async load(auditId) {
      const { data, error } = await supabaseAdmin()
        .from("audits")
        .select("id, n, instance_seed, issued_instance")
        .eq("id", auditId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as IssuanceRow | null) ?? null;
    },
    async claimSeed(auditId, seed, issuance) {
      // `.is("instance_seed", null)` is what makes this a claim rather than an
      // overwrite: Postgres serialises the two updates and the second matches
      // no rows.
      const { data, error } = await supabaseAdmin()
        .from("audits")
        .update({ instance_seed: seed, issued_instance: issuance, updated_at: new Date().toISOString() })
        .eq("id", auditId)
        .is("instance_seed", null)
        .select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },
    async writeCache(auditId, issuance) {
      // Deliberately does NOT touch instance_seed: the seed is written once,
      // by claimSeed, and nothing may overwrite it.
      const { error } = await supabaseAdmin()
        .from("audits")
        .update({ issued_instance: issuance, updated_at: new Date().toISOString() })
        .eq("id", auditId);
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * The hook: issue an instance for an audit that has just reached
 * `awaiting_evidence`.
 *
 * Deliberately does NOT throw. An audit that exists without an instance is
 * recoverable — the serving route issues idempotently on first fetch — whereas
 * failing the submit or the payment verification over it would lose a paid
 * audit for a reason the customer cannot act on. The failure is logged so a
 * systematic problem is visible rather than silently absorbed.
 */
export async function ensureInstanceIssued(auditId: string): Promise<boolean> {
  try {
    await issueInstance(auditId, supabaseIssuanceStore());
    return true;
  } catch (err) {
    console.warn(`[issuance] could not issue an instance for ${auditId}: ${String(err).slice(0, 200)}`);
    return false;
  }
}

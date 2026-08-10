// SPDX-License-Identifier: Apache-2.0
/**
 * GET /api/audit/:id/instance — the private instance this audit runs against.
 *
 * WHY THIS DID NOT EXIST UNTIL NOW. Step 6 built the issuance and deliberately
 * shipped no route for it: an ungated endpoint would hand a customer's private
 * instance to anyone who could name an audit id, which is the exact opposite of
 * what issuance is for. The gate is the feature, so the route waited for it.
 *
 * THE GATE, in order, failing closed at every step:
 *
 *   1. WALLET OWNERSHIP — a signed, single-use nonce proves the caller holds
 *      the key for some wallet (lib/wallet-auth.ts, the same primitive the
 *      dashboard uses). Checked FIRST so the nonce is consumed whatever
 *      happens: an attacker cannot probe audit ids for free.
 *   2. THAT wallet owns THIS audit. A mismatch answers 404, not 403 — telling a
 *      stranger "this audit exists but is not yours" is itself a disclosure.
 *   3. STATUS is `awaiting_evidence`. Before payment there is nothing to run;
 *      after evidence is in, re-serving the instance would let a customer see
 *      what they were tested on and resubmit against it.
 *
 * WHAT IS NEVER SERVED: `instance_seed`. The response carries only the DERIVED
 * instance. A client holding the seed could predict every future run of the
 * audit — and derive the category-F mints for cells it has not reached yet.
 *
 * WHY GET WITH HEADERS. The dashboard's equivalent is POST because it carries a
 * credential in a body; here the credential rides in headers, which keeps it
 * out of the URL (access logs, history, Referer) for the same reason. A GET is
 * the honest verb for "give me my instance", and `no-store` is unambiguous.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { verifyWalletOwnership, type AuthResult } from "../../../../../lib/wallet-auth";
import {
  clientPayload,
  issueInstance,
  supabaseIssuanceStore,
  type IssuanceStore,
} from "../../../../../lib/instance-issuance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "cdn-cache-control": "no-store",
} as const;

/** The only status from which an instance may be served. */
const SERVABLE_STATUS = "awaiting_evidence";

/** The audit fields the gate needs. */
export interface InstanceAuditRow {
  id: string;
  wallet: string;
  status: string;
  n: number;
}

export interface InstancePorts {
  /** Proves the caller owns a wallet. Injected so the gate is testable. */
  verifyOwner(credentials: { wallet: unknown; nonce: unknown; signature: unknown }): Promise<AuthResult>;
  loadAudit(auditId: string): Promise<InstanceAuditRow | null>;
  store: IssuanceStore;
}

function ports(): InstancePorts {
  return {
    verifyOwner: verifyWalletOwnership,
    async loadAudit(auditId) {
      const { data, error } = await supabaseAdmin()
        .from("audits")
        .select("id, wallet, status, n")
        .eq("id", auditId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as InstanceAuditRow | null) ?? null;
    },
    store: supabaseIssuanceStore(),
  };
}

/**
 * The handler proper, with its ports injected.
 *
 * Exported so the whole gate — header parsing, ownership, status, the
 * indistinguishable 404 — can be exercised end to end without a database.
 */
export async function handleInstanceGet(req: Request, auditId: string, injected: InstancePorts) {
  if (!auditId || !/^[0-9a-f-]{8,64}$/i.test(auditId)) {
    return NextResponse.json({ error: "invalid audit id" }, { status: 400, headers: NO_STORE });
  }

  // 1. Ownership of SOME wallet. First, so the nonce burns either way.
  const auth = await injected.verifyOwner({
    wallet: req.headers.get("x-solverdict-wallet"),
    nonce: req.headers.get("x-solverdict-nonce"),
    signature: req.headers.get("x-solverdict-signature"),
  });
  if (!auth.ok) {
    // One opaque message for every failure mode. Distinguishing "unknown nonce"
    // from "bad signature" would tell an attacker which half they got right.
    return NextResponse.json(
      {
        error:
          "wallet ownership not proven — obtain a challenge from POST /api/auth/nonce, sign it, and send " +
          "x-solverdict-wallet / x-solverdict-nonce / x-solverdict-signature",
      },
      { status: auth.reason === "storage" ? 503 : 401, headers: NO_STORE },
    );
  }

  let row: InstanceAuditRow | null;
  try {
    row = await injected.loadAudit(auditId);
  } catch (err) {
    return NextResponse.json(
      { error: `lookup failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502, headers: NO_STORE },
    );
  }

  // 2. Ownership of THIS audit. Same answer as "no such audit", on purpose.
  if (!row || row.wallet !== auth.wallet) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  // 3. The window in which an instance is meaningful.
  if (row.status !== SERVABLE_STATUS) {
    return NextResponse.json(
      {
        error: `no instance to serve: audit status is ${row.status}`,
        detail:
          row.status === "awaiting_payment"
            ? "the instance is issued once payment is verified"
            : "an instance is served only while an audit is waiting for evidence",
      },
      { status: 409, headers: NO_STORE },
    );
  }

  // Issue on demand if the hook at status transition did not run. Idempotent:
  // an audit that already has a seed gets the instance that seed derives.
  try {
    const issuance = await issueInstance(auditId, injected.store);
    return NextResponse.json(
      {
        ...clientPayload(issuance),
        n: row.n,
        // Everything the client needs to run; nothing it must not hold.
        // --n is stated explicitly even though the harness now reads it from
        // this file: a client built before that change defaults to the
        // pre-registered N=20, and on a free audit (n=1) that runs 400 cells
        // whose extras fall back to public fixtures and are refused.
        usage:
          `save as instance.json, then: npx solverdict-run --agent ./my-agent.mjs ` +
          `--audit ${auditId} --instance ./instance.json --n ${row.n}`,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: `could not issue an instance: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502, headers: NO_STORE },
    );
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handleInstanceGet(req, params.id, ports());
}

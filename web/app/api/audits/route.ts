// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/audits — a wallet's OWN audit history, newest first, 20 per page.
 *
 * Body:   { wallet, nonce, signature, page? }
 * Header: x-solverdict-session — a live session replaces the three credential
 *         fields. Nothing else accepts it; see POST /api/auth/session.
 * 200:  { audits, page, pageSize, total, hasMore }
 * 401:  the signature does not prove ownership of `wallet`
 *
 * FINDING #9 (P1). This route used to be `GET ?wallet=<pubkey>` and trusted the
 * parameter. Pubkeys are public, so anyone could list any wallet's history —
 * including audits the owner never opted into the public ranking. Each row
 * carries the audit UUID, and that UUID is the whole of the access control on
 * `/api/audit/<id>`, which returns the full result, the submitter's email and
 * the payment signature. Knowing a pubkey therefore read every private audit
 * that wallet had ever run.
 *
 * WHY NOT "filter out private audits". That would close the leak by breaking
 * the feature: the dashboard exists to show an owner their own history, private
 * runs included. The right gate is proving ownership, which is what the old
 * route's own comment deferred to Sprint 7. `public_opt_in` stays what it is —
 * a publication choice for the leaderboard, not an access-control flag.
 *
 * WHY POST FOR A READ. The request carries a credential. A GET would put the
 * signature in the URL, where it lands in access logs, browser history, proxy
 * caches and `Referer` headers. POST keeps it in the body, and makes
 * cacheability unambiguous.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase";
import { verifyWalletAccess, SESSION_HEADER } from "../../../lib/wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The pre-fix endpoint. Answering it at all would re-open the leak, so it is
 * gone rather than merely unauthenticated — and it says how to migrate instead
 * of failing opaquely.
 */
export function GET() {
  return NextResponse.json(
    {
      error:
        "GET /api/audits was removed: it disclosed a wallet's audit ids to anyone who knew the pubkey. " +
        "Use POST /api/audits with { wallet, nonce, signature } after obtaining a challenge from POST /api/auth/nonce.",
    },
    { status: 410, headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // A live session, or a freshly signed challenge. The session is only ever a
  // receipt for a signature that already happened (lib/wallet-auth.ts); it
  // unlocks reading your OWN history and nothing else.
  const auth = await verifyWalletAccess({
    sessionToken: req.headers.get(SESSION_HEADER),
    wallet: b.wallet,
    nonce: b.nonce,
    signature: b.signature,
  });
  if (!auth.ok) {
    // One opaque message for every failure mode. Distinguishing "unknown nonce"
    // from "bad signature" would tell an attacker which half they got right.
    const status = auth.reason === "storage" ? 503 : 401;
    return NextResponse.json(
      {
        error:
          status === 503
            ? "Authentication is unavailable."
            : "Could not verify ownership of this wallet. Request a new challenge and sign it.",
      },
      { status, headers: NO_STORE },
    );
  }

  // From here the caller has PROVEN they hold this wallet's key, so their own
  // private audits are exactly what they are entitled to see.
  const wallet = auth.wallet;
  const page = Math.max(0, Number(b.page ?? 0) | 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count, error } = await supabaseAdmin()
      .from("audits")
      .select("id, created_at, endpoint, framework, model, tier, status", { count: "exact" })
      .eq("wallet", wallet)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);

    const audits = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      createdAt: r.created_at,
      endpoint: r.endpoint,
      framework: r.framework,
      model: r.model,
      tier: r.tier,
      status: r.status,
    }));

    const total = typeof count === "number" ? count : audits.length;
    return NextResponse.json(
      { audits, page, pageSize: PAGE_SIZE, total, hasMore: to + 1 < total },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return NextResponse.json({ error: `Lookup failed: ${String(err)}` }, { status: 502, headers: NO_STORE });
  }
}

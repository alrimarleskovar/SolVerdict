// SPDX-License-Identifier: Apache-2.0
/**
 * POST   /api/auth/session — trade one signed challenge for a ~30 minute session.
 * DELETE /api/auth/session — end it now.
 *
 * WHAT THIS IS NOT. It is not a second way to authenticate. The only way to get
 * a token is to present a signature that `verifyWalletOwnership` accepts, which
 * is the same check the dashboard has always run — the token is a receipt for
 * that proof, not a replacement for it.
 *
 * WHAT IT DOES NOT UNLOCK. Reading your own audit history, and nothing else.
 * Fetching an instance and submitting evidence keep their own signatures,
 * because those sign a specific payload — the challenge at the moment a secret
 * is handed over, and the manifest digest, which commits to every byte of a
 * bundle. A bearer token cannot express either claim.
 *
 * The token travels in a header, never a query parameter: URLs end up in access
 * logs, browser history, proxy caches and Referer.
 */
import { NextResponse } from "next/server";
import {
  issueSession,
  revokeSession,
  verifyWalletOwnership,
  SESSION_HEADER,
  SESSION_TTL_MS,
} from "../../../../lib/wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate", "cdn-cache-control": "no-store" } as const;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // The signature does the proving. Unchanged.
  const auth = await verifyWalletOwnership({ wallet: b.wallet, nonce: b.nonce, signature: b.signature });
  if (!auth.ok) {
    // One opaque message for every failure mode, as elsewhere: distinguishing
    // "unknown nonce" from "bad signature" tells an attacker which half landed.
    return NextResponse.json(
      { error: "Could not verify ownership of this wallet. Request a new challenge and sign it." },
      { status: auth.reason === "storage" ? 503 : 401, headers: NO_STORE },
    );
  }

  try {
    const session = await issueSession(auth.wallet);
    return NextResponse.json(
      {
        token: session.token,
        expiresAt: session.expiresAt,
        ttlMs: SESSION_TTL_MS,
        header: SESSION_HEADER,
        // Said out loud so nobody builds on the wrong assumption.
        scope: "reading your own audit history; instance and evidence still require a signature",
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    // Fail closed: no session means the signature path still works.
    return NextResponse.json(
      { error: `Could not start a session: ${String(err).slice(0, 160)}` },
      { status: 503, headers: NO_STORE },
    );
  }
}

/**
 * Revocation needs no signature: the only thing it can do is destroy the
 * caller's own credential, and requiring a wallet popup to log out would defeat
 * the point. Presenting someone else's token would end their session — but
 * holding their token is already the worse problem, and this is the action that
 * fixes it.
 */
export async function DELETE(req: Request) {
  await revokeSession(req.headers.get(SESSION_HEADER));
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}

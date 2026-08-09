// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/auth/nonce — issue a single-use challenge for wallet-ownership proof.
 *
 * Body: { wallet }
 * 200:  { nonce, message, issuedAt, expiresAt }
 *
 * The `message` is what the client asks the wallet to sign. It is returned for
 * convenience only: the server rebuilds it from its own stored nonce row when
 * verifying, so a client that signs something else simply fails.
 *
 * Issuing a nonce discloses nothing — it is random bytes bound to a pubkey the
 * caller already supplied. The secret being tested is the private key.
 */
import { NextResponse } from "next/server";
import { BASE58_PUBKEY, issueNonce } from "../../../../lib/wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const wallet = (body as { wallet?: unknown } | null)?.wallet;
  if (typeof wallet !== "string" || !BASE58_PUBKEY.test(wallet)) {
    return NextResponse.json({ error: "a valid wallet pubkey is required" }, { status: 400, headers: NO_STORE });
  }

  try {
    const issued = await issueNonce(wallet);
    return NextResponse.json(issued, { status: 200, headers: NO_STORE });
  } catch (err) {
    // Fail CLOSED. The most likely cause is the auth_nonces table not existing
    // yet (migration 002 not applied); without a nonce nobody can authenticate,
    // which is the safe direction.
    return NextResponse.json(
      { error: `Could not issue a challenge: ${String(err).slice(0, 160)}` },
      { status: 503, headers: NO_STORE },
    );
  }
}

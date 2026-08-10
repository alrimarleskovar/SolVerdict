// SPDX-License-Identifier: Apache-2.0
/**
 * The text a wallet signs to submit an evidence bundle.
 *
 * Extracted from lib/evidence-intake.ts so the BROWSER can build it too. The
 * server rebuilds this string from its own stored audit id and the digest of
 * the manifest bytes it received, then verifies the signature against it — so
 * the client has to produce it byte for byte, and the only safe way to
 * guarantee that is for both sides to call the same function.
 *
 * It cannot live in evidence-intake.ts: importing that from a client component
 * would drag issuance/, scenarios/ and the scoring engine into the browser
 * bundle. This module has no imports at all, deliberately.
 *
 * Changing a single character here invalidates every signature in flight and
 * rejects every submission produced by an older client. lib/evidence-intake
 * .test.ts pins the exact output against a golden string for that reason.
 */

/** Domain-separated so an evidence signature cannot be replayed as a login. */
export const EVIDENCE_DOMAIN = "solverdict.vercel.app/evidence";

/**
 * Binds the domain (no cross-site replay), the audit (a signature for one audit
 * cannot submit evidence for another) and the manifest digest (which in turn
 * commits to the archive's sha256, hence to every byte of evidence).
 */
export function buildEvidenceMessage(args: { auditId: string; manifestSha256: string }): string {
  return [
    `${EVIDENCE_DOMAIN} — submit audit evidence`,
    "",
    `Audit: ${args.auditId}`,
    `Manifest SHA-256: ${args.manifestSha256}`,
    "",
    "Signing submits this evidence bundle for server-side scoring.",
    "This does not authorise any transaction and moves no funds.",
  ].join("\n");
}

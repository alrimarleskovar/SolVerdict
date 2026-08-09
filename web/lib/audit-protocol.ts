// SPDX-License-Identifier: Apache-2.0
/**
 * The SolVerdict submission protocol — what a client sends, and its limits.
 *
 * WHAT THIS FILE USED TO BE. An HTTP request/response contract: SolVerdict
 * POSTed `{protocol, scenarioId, task, context, walletPubkey, rpcUrl, timeoutMs}`
 * to an endpoint the customer hosted, and validated a reply carrying base64
 * transactions. That direction is gone (step 8). It could not survive the
 * local-adapter migration for a concrete reason: `rpcUrl` pointed at
 * `localhost:8899` on OUR machine, which resolves on the customer's machine to
 * their own loopback — the contract was unimplementable the moment the fork and
 * the agent stopped sharing a host.
 *
 * WHAT IT IS NOW. The audit runs on the customer's machine and only the
 * EVIDENCE travels, so the protocol is a file format plus the rules for
 * accepting it: an archive, a manifest that commits to it, and a wallet
 * signature over the manifest. `PROTOCOL_VERSION` names that format. The
 * verification itself lives in lib/evidence-intake.ts; this module holds the
 * constants both the client and the server must agree on, in one place, so the
 * docs page and the route cannot drift from each other.
 */

/**
 * The evidence-bundle format version.
 *
 * Deliberately a NEW identifier rather than `solverdict/v2`: this is not a
 * later revision of the request/response protocol, it is a different artefact
 * with a different direction of travel. Reusing the old name would let a client
 * built for the HTTP era believe it was compatible.
 */
export const PROTOCOL_VERSION = "solverdict-bundle/v1";

/**
 * Largest archive the intake endpoint will buffer.
 *
 * A full paid audit — 20 scenarios × N=20, with per-run transactions, RPC
 * transcripts and action logs — packs to a few megabytes. 64 MB is far above
 * any legitimate bundle and low enough that a hostile upload cannot exhaust the
 * request handler.
 */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Where to report abuse or a suspected flaw in the protocol itself. */
export const ABUSE_CONTACT = "https://github.com/alrimarleskovar/SolVerdict/security/advisories/new";

/**
 * The manifest a client submits alongside the archive.
 *
 * Produced by `@solverdict/harness` (`packageSubmission`). The server never
 * re-serialises it — the signature is over the received bytes, so a whitespace
 * change would invalidate it.
 */
export interface BundleManifest {
  /** The audit this evidence answers; binds the bundle to one paid audit. */
  auditId: string | null;
  runId: string;
  producedBy: string;
  preregVersion: string;
  /** Digest of the pre-registration document the harness implements. */
  preregSha256: string;
  bundle: { file: string; bytes: number; sha256: string };
  /** `scenarioId#runIndex` per run present, so the shape is legible unpacked. */
  cells: string[];
  generatedAt: string;
}

/**
 * The fields a submission must carry, as multipart form data.
 *
 * `manifest` may be a file part or a plain string; either way the digest is
 * taken over exactly the bytes received.
 */
export const SUBMISSION_FIELDS = ["bundle", "manifest", "signature"] as const;

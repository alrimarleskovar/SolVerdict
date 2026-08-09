// SPDX-License-Identifier: Apache-2.0
/**
 * Package an evidence tree into something a server can accept and check.
 *
 * A directory of JSON is not a submission. The server has to be able to answer
 * three questions before it will spend anything scoring it: are these the bytes
 * the client meant to send, did the wallet that owns the audit actually send
 * them, and were they produced under the methodology we published. So a
 * submission is three things:
 *
 *   <runId>.tar.gz          the evidence, exactly as the runner wrote it
 *   <runId>.manifest.json   the digest of that archive, plus provenance
 *   a signature             over the manifest digest, by the audit's wallet
 *
 * The signature covers the MANIFEST DIGEST rather than the archive, so the
 * client signs 64 hex characters instead of streaming a multi-megabyte file
 * through a browser wallet — and because the manifest commits to the archive's
 * own sha256, signing the manifest still commits to every byte of evidence.
 *
 * This module deliberately does not sign anything. The key lives in the user's
 * wallet, not in a CLI, and a harness that could sign is a harness that could
 * submit on their behalf.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PREREG } from "./config/prereg.js";

/**
 * The evidence-bundle format this package produces.
 *
 * Restated here rather than imported from the server: the harness ships without
 * the web app. `web/lib/audit-protocol.ts` holds the server's copy and the two
 * must agree — a mismatch is what tells an old client to update.
 */
export const BUNDLE_FORMAT = "solverdict-bundle/v1";

export interface SubmissionManifest {
  /** The bundle format these bytes are laid out in. */
  format: typeof BUNDLE_FORMAT;
  /** The audit this evidence answers. Binds the bundle to one paid audit. */
  auditId: string | null;
  runId: string;
  producedBy: string;
  preregVersion: string;
  /**
   * Digest of the pre-registration document this harness implements.
   *
   * Restated from config/prereg.ts because the package ships no document. The
   * server compares it against the digest of the document it holds, which is
   * what stops a stale harness from submitting evidence for a methodology that
   * has since been amended.
   */
  preregSha256: string;
  bundle: { file: string; bytes: number; sha256: string };
  /** Cells present, so the server can see the shape without unpacking. */
  cells: string[];
  generatedAt: string;
}

export interface PackagedSubmission {
  bundlePath: string;
  manifestPath: string;
  manifest: SubmissionManifest;
  /** sha256 of the manifest bytes — this is what the wallet signs. */
  manifestSha256: string;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const subdirs = (p: string): string[] =>
  existsSync(p) ? readdirSync(p).filter((e) => statSync(path.join(p, e)).isDirectory()) : [];

/**
 * Tars `<parent>/<runId>` and writes its manifest beside it.
 *
 * The archive is built with `-C <parent>` so its paths start at `<runId>/`
 * rather than at whatever absolute path this machine happens to use — the
 * server extracts the same tree regardless of where it was produced.
 */
export function packageSubmission(args: { runDir: string; auditId?: string | null }): PackagedSubmission {
  const runDir = path.resolve(args.runDir);
  const parent = path.dirname(runDir);
  const runId = path.basename(runDir);
  const bundlePath = path.join(parent, `${runId}.tar.gz`);
  const manifestPath = path.join(parent, `${runId}.manifest.json`);

  execSync(`tar -czf ${JSON.stringify(bundlePath)} -C ${JSON.stringify(parent)} ${JSON.stringify(runId)}`, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const bytes = readFileSync(bundlePath);
  const cells: string[] = [];
  for (const setupId of subdirs(runDir))
    for (const scenarioId of subdirs(path.join(runDir, setupId)))
      for (const n of subdirs(path.join(runDir, setupId, scenarioId))) cells.push(`${scenarioId}#${n}`);
  cells.sort();

  const manifest: SubmissionManifest = {
    format: BUNDLE_FORMAT,
    auditId: args.auditId ?? null,
    runId,
    producedBy: "@solverdict/harness",
    preregVersion: PREREG.version,
    preregSha256: PREREG.sha256,
    bundle: { file: `${runId}.tar.gz`, bytes: bytes.length, sha256: sha256(bytes) },
    cells,
    generatedAt: new Date().toISOString(),
  };

  // Stable serialisation: the digest the wallet signs must be reproducible from
  // the file the server receives, byte for byte.
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(manifestPath, manifestBytes);

  return { bundlePath, manifestPath, manifest, manifestSha256: sha256(manifestBytes) };
}

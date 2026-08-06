// SPDX-License-Identifier: Apache-2.0
/**
 * Evidence bundling for OFFICIAL bench runs.
 *
 * Lives here rather than in bench.ts so it can be unit-tested: bench.ts invokes
 * `main()` at module scope, so importing it would start a benchmark run.
 *
 * WHY BUNDLES EXIST. Run B's per-run transcripts were gitignored. When a
 * scoring defect surfaced later — the intent matcher missing ten state-changing
 * SAK actions — its blast radius on the published numbers could not be measured,
 * because no committed evidence remained to re-score. Aggregate snapshots record
 * counts; only the per-run action log can answer "did this contained run
 * actually attempt something dangerous?".
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export interface EvidenceBundle {
  bundlePath: string;
  manifestPath: string;
  bytes: number;
  sha256: string;
}

export interface PackageEvidenceArgs {
  /** Directory containing the run trees (…/runs). */
  runsDir: string;
  runId: string;
  /** run-metadata.json contents, embedded in the manifest for provenance. */
  metadata: Record<string, unknown>;
  /** Per-setup run counts, so a manifest is auditable without unpacking. */
  perCell: unknown;
}

/**
 * Compress `runs/<runId>/` into `runs/evidence/<runId>.tar.gz` and write a
 * manifest recording the bundle's sha256 alongside the run's provenance.
 *
 * Throws on failure; callers in the bench path catch and warn rather than
 * failing a completed run — the scoring is already written, and losing a bundle
 * must never discard a finished official run.
 */
export function packageEvidence(args: PackageEvidenceArgs): EvidenceBundle {
  const { runsDir, runId, metadata, perCell } = args;
  const evidenceDir = path.join(runsDir, "evidence");
  const bundleName = `${runId}.tar.gz`;
  const bundlePath = path.join(evidenceDir, bundleName);
  const manifestPath = path.join(evidenceDir, `${runId}.manifest.json`);

  mkdirSync(evidenceDir, { recursive: true });
  // -C keeps archive paths relative to runs/, so extraction reproduces
  // `<runId>/…` rather than an absolute path from this machine.
  execSync(`tar -czf ${JSON.stringify(bundlePath)} -C ${JSON.stringify(runsDir)} ${JSON.stringify(runId)}`, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const bytes = readFileSync(bundlePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    runId,
    generatedAt: new Date().toISOString(),
    bundle: { file: bundleName, bytes: bytes.length, sha256 },
    resultsFile: "report/results.json (copy to report/results-OFFICIAL-<tag>.json to publish)",
    metadata,
    perCell,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return { bundlePath, manifestPath, bytes: bytes.length, sha256 };
}

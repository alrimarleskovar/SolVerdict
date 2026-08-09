// SPDX-License-Identifier: Apache-2.0
/**
 * Provenance tests for published official snapshots.
 *
 * WHY. The v0.3.0 official run was published with its evidence bundle sitting
 * correctly in runs/evidence/ — and no way to find it. `bench.ts` never wrote
 * the runId into results.json, so the artifact could not name the run tree it
 * came from. The bundle existed, the data was right, and the link between them
 * lived only in someone's memory. Same class as the prereg-version drift: the
 * numbers were fine, the artifact was not self-auditable.
 *
 * `npm run lint:evidence` catches a missing bundle. These tests catch the
 * SOURCE — a snapshot that cannot locate its own evidence — and go one step
 * further than the lint by checking that the snapshot and the bundle actually
 * describe the SAME campaign, not merely that a file with the right name is
 * present. A bundle whose seed or plan fingerprint disagrees with the board is
 * worse than a missing one: it looks like corroboration.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import grandfatheredJson from "../config/evidence-grandfathered.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPORT_DIR = path.join(ROOT, "report");
const EVIDENCE_DIR = path.join(ROOT, "runs", "evidence");

/** Shared with scripts/check-evidence-bundles.mjs — one list, no drift. */
const GRANDFATHERED = new Set<string>(grandfatheredJson.snapshots);

/**
 * EXACTLY the expression scripts/check-evidence-bundles.mjs uses. If the lint's
 * lookup ever moves, this must move with it — which is the point: the producer
 * (bench.ts) and the checker have to agree on one key.
 */
function locateRunId(snapshot: Record<string, unknown>): string | null {
  const meta = snapshot.metadata as { runId?: string } | undefined;
  return (snapshot.runId as string | undefined) ?? meta?.runId ?? null;
}

const officialFiles = readdirSync(REPORT_DIR)
  .filter((f) => f.startsWith("results-OFFICIAL-") && f.endsWith(".json"))
  .sort();

assert.ok(officialFiles.length > 0, "no official snapshots found — the glob or the directory moved");

let verified = 0;
for (const file of officialFiles) {
  if (GRANDFATHERED.has(file)) continue;

  const snapshot = JSON.parse(readFileSync(path.join(REPORT_DIR, file), "utf8"));

  // --- 1. the snapshot can locate its own evidence -------------------------
  const runId = locateRunId(snapshot);
  assert.ok(
    runId,
    `${file}: no runId at the key the evidence lint reads. A published board that cannot name ` +
      `its run tree cannot be matched to the transcripts it was scored from. bench.ts must write ` +
      `\`runId\` at the top level of results.json.`,
  );
  assert.match(runId!, /^\d{4}-\d{2}-\d{2}T\d{6}Z$/, `${file}: runId "${runId}" is not a bench run id`);

  // --- 2. the bundle and manifest it names actually exist ------------------
  const bundlePath = path.join(EVIDENCE_DIR, `${runId}.tar.gz`);
  const manifestPath = path.join(EVIDENCE_DIR, `${runId}.manifest.json`);
  assert.ok(existsSync(bundlePath), `${file}: missing runs/evidence/${runId}.tar.gz`);
  assert.ok(existsSync(manifestPath), `${file}: missing runs/evidence/${runId}.manifest.json`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // --- 3. the bundle is intact ---------------------------------------------
  const actual = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
  assert.equal(manifest?.bundle?.sha256, actual, `${file}: bundle sha256 does not match its manifest`);

  // --- 4. snapshot and bundle describe the SAME campaign -------------------
  // Beyond what the lint checks. A name match proves a file is present; these
  // prove it is the right one. Any of these disagreeing means the snapshot has
  // been paired with evidence from a different run.
  assert.equal(manifest.runId, runId, `${file}: manifest.runId disagrees with the snapshot's runId`);
  const mExec = manifest?.metadata?.execution ?? {};
  const sExec = snapshot?.meta?.execution ?? {};
  if (sExec.seed !== undefined) {
    assert.equal(mExec.seed, sExec.seed, `${file}: seed differs between snapshot and bundle`);
  }
  if (sExec.planFingerprint !== undefined) {
    assert.equal(
      mExec.planFingerprint,
      sExec.planFingerprint,
      `${file}: plan fingerprint differs — the bundle is from a different campaign`,
    );
  }
  if (sExec.plannedRuns !== undefined) {
    assert.equal(mExec.plannedRuns, sExec.plannedRuns, `${file}: plannedRuns differs`);
  }
  if (snapshot?.meta?.preregSha256) {
    assert.equal(
      manifest?.metadata?.prereg?.sha256,
      snapshot.meta.preregSha256,
      `${file}: the snapshot and its evidence cite different prereg documents`,
    );
  }
  // The run id is derived from the campaign's start time (bench.ts makeRunId).
  if (manifest?.metadata?.startTime) {
    const derived = new Date(manifest.metadata.startTime).toISOString().slice(0, 19).replace(/:/g, "") + "Z";
    assert.equal(derived, runId, `${file}: runId does not match the bundle's startTime`);
  }

  verified++;
}

// --- the guard must actually be reachable -----------------------------------
// If every official snapshot were grandfathered, the loop above would assert
// nothing and pass vacuously. Fail loudly instead of reporting false comfort.
assert.ok(
  verified > 0,
  "no non-grandfathered official snapshot was checked — this test would pass vacuously. " +
    "Either the grandfather list has swallowed everything, or no post-policy run has been published.",
);

// --- the negative case: a snapshot without a runId must FAIL ----------------
{
  assert.equal(locateRunId({ meta: {}, setups: [] }), null, "a snapshot with no runId must not resolve one");
  assert.equal(locateRunId({ runId: "2026-08-08T213043Z" }), "2026-08-08T213043Z", "top-level runId resolves");
  assert.equal(locateRunId({ metadata: { runId: "x" } }), "x", "the legacy metadata.runId path still resolves");
}

console.log(`results-provenance tests passed (${verified} official snapshot(s) verified against their bundles)`);

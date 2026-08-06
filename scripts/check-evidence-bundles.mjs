// SPDX-License-Identifier: Apache-2.0
/**
 * Guard: every OFFICIAL scoring snapshot published from now on must ship the
 * per-run evidence it was derived from.
 *
 * This exists because Run B did not. Its transcripts were gitignored, so when a
 * scoring defect was found later, the blast radius on the published numbers
 * could not be measured without re-running paid setups. Aggregate snapshots
 * record counts; only the per-run action log can answer "did this contained run
 * actually attempt something dangerous?".
 *
 * Checks, for each report/results-OFFICIAL-*.json:
 *   1. a runs/evidence/<runId>.tar.gz bundle exists;
 *   2. a runs/evidence/<runId>.manifest.json exists;
 *   3. the manifest's recorded sha256 matches the bundle on disk.
 *
 * Snapshots predating this policy are grandfathered by explicit name below —
 * their evidence is genuinely unrecoverable, and pretending otherwise would be
 * worse than recording the gap.
 *
 * Run: npm run lint:evidence
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPORT_DIR = path.join(ROOT, "report");
const EVIDENCE_DIR = path.join(ROOT, "runs", "evidence");

/**
 * Snapshots published BEFORE evidence bundling existed. Their per-run
 * transcripts were never committed and cannot be reconstructed. Do NOT add to
 * this list to silence a failure on a new run — bundle the run instead.
 */
const GRANDFATHERED = new Set([
  "results-OFFICIAL-v021-attempt1-0048.json",
  "results-OFFICIAL-v021-attempt1-0053.json",
  "results-OFFICIAL-v021-attempt2-0152.json",
  "results-OFFICIAL-v021-FINAL-0145.json",
  "results-OFFICIAL-v022-runB-0149.json",
  "results-OFFICIAL-v022-runC-partial-2103.json",
]);

const problems = [];
const checked = [];

const official = existsSync(REPORT_DIR)
  ? readdirSync(REPORT_DIR).filter((f) => f.startsWith("results-OFFICIAL-") && f.endsWith(".json"))
  : [];

for (const file of official.sort()) {
  if (GRANDFATHERED.has(file)) {
    checked.push(`${file}: grandfathered (pre-policy; evidence unrecoverable)`);
    continue;
  }

  let runId = null;
  try {
    const snapshot = JSON.parse(readFileSync(path.join(REPORT_DIR, file), "utf8"));
    runId = snapshot.runId ?? snapshot.metadata?.runId ?? null;
  } catch (err) {
    problems.push(`${file}: unreadable (${String(err).slice(0, 100)})`);
    continue;
  }
  if (!runId) {
    problems.push(`${file}: no runId recorded, so its evidence bundle cannot be located`);
    continue;
  }

  const bundle = path.join(EVIDENCE_DIR, `${runId}.tar.gz`);
  const manifestPath = path.join(EVIDENCE_DIR, `${runId}.manifest.json`);
  if (!existsSync(bundle)) {
    problems.push(`${file}: missing evidence bundle runs/evidence/${runId}.tar.gz`);
    continue;
  }
  if (!existsSync(manifestPath)) {
    problems.push(`${file}: missing runs/evidence/${runId}.manifest.json`);
    continue;
  }

  const actual = createHash("sha256").update(readFileSync(bundle)).digest("hex");
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"))?.bundle?.sha256;
  if (expected !== actual) {
    problems.push(`${file}: bundle sha256 mismatch (manifest ${String(expected).slice(0, 16)}…, actual ${actual.slice(0, 16)}…)`);
    continue;
  }
  checked.push(`${file}: bundle + manifest verified (${runId})`);
}

for (const line of checked) console.log(`  ${line}`);
if (problems.length > 0) {
  console.error(`\nEvidence check FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nBundle the run before publishing its snapshot; see runs/evidence/README.md.`);
  process.exit(1);
}
console.log(`Evidence check OK — ${official.length} official snapshot(s), ${GRANDFATHERED.size} grandfathered.`);

// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for official-run evidence bundling.
 *
 * The point of the bundle is that a published number stays re-auditable after
 * the working run tree is regenerated. So these tests assert not just that a
 * file appears, but that the archive ROUND-TRIPS: extracting it reproduces the
 * per-run transcripts byte-for-byte, and the manifest's sha256 matches the
 * bundle actually on disk (which is what `npm run lint:evidence` verifies in
 * CI). Runs entirely in a temp dir; touches nothing in the repo.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { packageEvidence } from "./evidence.js";

let failures = 0;
let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name}\n  ${(err as Error).message}`);
  }
}
function expect(actual: unknown) {
  return {
    toBe(want: unknown): void {
      if (actual !== want) throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    },
  };
}

const root = mkdtempSync(path.join(tmpdir(), "solverdict-evidence-"));
const runsDir = path.join(root, "runs");
const RUN_ID = "2026-08-06T120000Z";

// A miniature but realistic run tree: setup / scenario / n / files.
const runDir = path.join(runsDir, RUN_ID, "sak+claude", "A1", "0");
mkdirSync(runDir, { recursive: true });
const ACTIONS = JSON.stringify([{ index: 0, tool: "TRADE", args: { inputAmount: 12 }, validity: "ok" }], null, 2);
writeFileSync(path.join(runDir, "actions.json"), ACTIONS);
writeFileSync(path.join(runDir, "outcome.json"), '"intent-dangerous-exec-failed"');
writeFileSync(path.join(runsDir, RUN_ID, "run-metadata.json"), JSON.stringify({ runId: RUN_ID }, null, 2));

const result = packageEvidence({
  runsDir,
  runId: RUN_ID,
  metadata: { runId: RUN_ID, preregVersion: "v0.3.0", n: 20 },
  perCell: [{ setupId: "sak+claude", runCounts: { attempted: 20, valid: 20 } }],
});

test("writes the bundle and the manifest", () => {
  expect(existsSync(result.bundlePath)).toBe(true);
  expect(existsSync(result.manifestPath)).toBe(true);
});

test("manifest sha256 matches the bundle on disk (what CI verifies)", () => {
  const actual = createHash("sha256").update(readFileSync(result.bundlePath)).digest("hex");
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  expect(manifest.bundle.sha256).toBe(actual);
  expect(manifest.bundle.sha256).toBe(result.sha256);
  expect(manifest.bundle.bytes).toBe(result.bytes);
});

test("manifest carries provenance without needing the archive unpacked", () => {
  const m = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  expect(m.runId).toBe(RUN_ID);
  expect(m.metadata.preregVersion).toBe("v0.3.0");
  expect(m.perCell[0].setupId).toBe("sak+claude");
});

test("archive round-trips: per-run transcripts extract byte-identical", () => {
  const out = path.join(root, "extracted");
  mkdirSync(out, { recursive: true });
  execSync(`tar -xzf ${JSON.stringify(result.bundlePath)} -C ${JSON.stringify(out)}`);
  // Paths are relative to runs/, so the run id is the archive's top-level entry.
  const restored = path.join(out, RUN_ID, "sak+claude", "A1", "0", "actions.json");
  expect(existsSync(restored)).toBe(true);
  expect(readFileSync(restored, "utf8")).toBe(ACTIONS);
});

test("the action log survives — the thing aggregates cannot reconstruct", () => {
  const out = path.join(root, "extracted");
  const restored = JSON.parse(
    readFileSync(path.join(out, RUN_ID, "sak+claude", "A1", "0", "actions.json"), "utf8"),
  );
  // Exactly the evidence that was missing when Run B needed re-scoring.
  expect(restored[0].tool).toBe("TRADE");
  expect(restored[0].args.inputAmount).toBe(12);
});

test("bundling is meaningfully compressive", () => {
  // Not a strict ratio assertion (tiny fixture), just that it produced a real
  // gzip stream rather than an empty or uncompressed file.
  const head = readFileSync(result.bundlePath).subarray(0, 2);
  expect(head[0]).toBe(0x1f);
  expect(head[1]).toBe(0x8b);
});

rmSync(root, { recursive: true, force: true });

if (failures > 0) {
  console.error(`${failures} evidence test(s) failed (${passed} passed)`);
  process.exit(1);
}
console.log(`evidence tests passed (${passed} assertions)`);

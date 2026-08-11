#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * DRIFT GUARD for the vendored @solverdict/harness sources.
 *
 * packages/harness/src/ holds byte-copies of env/, the client scenario halves,
 * lib/ and the client-safe config, so the package is self-contained and
 * publishable. Copies rot: a fix applied to env/txparse.ts that never reaches
 * the vendored copy means clients run different capture code than the bench —
 * and the evidence they submit stops matching what the server expects.
 *
 * This asserts every vendored file is byte-identical to its origin. Re-vendor
 * (scripts/vendor-harness.mjs) rather than editing a copy by hand.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "packages/harness/src");
/** Package-authored, not copied from the repo root — excluded from the compare. */
const AUTHORED = new Set(["index.ts", "runner.ts", "bin.ts", "submission.ts", "state-dir.ts"]);

/**
 * Generated at runtime, not copied from a source of truth. config/forkslot.json
 * is written by the first surfnet launch and is per-machine by construction, so
 * byte-equality with the repo's copy is the wrong assertion — comparing it would
 * make this guard fail after any local run.
 */
const GENERATED = new Set([path.join("config", "forkslot.json")]);

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const drift = [];
const missing = [];
let checked = 0;
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (AUTHORED.has(rel) || GENERATED.has(rel)) continue;
  const origin = path.join(ROOT, rel);
  if (!existsSync(origin)) { missing.push(rel); continue; }
  checked++;
  if (!readFileSync(file).equals(readFileSync(origin))) drift.push(rel);
}

if (missing.length || drift.length) {
  if (missing.length) console.error(`\nvendored files with no origin:\n  ${missing.join("\n  ")}`);
  if (drift.length) console.error(`\nvendored copies that DIFFER from their origin:\n  ${drift.join("\n  ")}`);
  console.error("\nRe-vendor with: node scripts/vendor-harness.mjs\n");
  process.exit(1);
}
if (checked < 20) {
  console.error(`harness drift: only ${checked} files compared — the walk is broken`);
  process.exit(1);
}
console.log(`Harness vendor OK — ${checked} vendored files byte-identical to their in-repo origin.`);

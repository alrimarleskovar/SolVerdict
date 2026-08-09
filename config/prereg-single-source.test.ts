// SPDX-License-Identifier: Apache-2.0
/**
 * ARCHITECTURAL GUARD: config/prereg.ts is the only place the methodology
 * version, the scenario count and the category count are declared.
 *
 * WHY. `web/worker/run-audit.ts` hardcoded `PREREG_VERSION = "v0.2.2"` while
 * importing SCENARIOS from the v0.3.0 rubric, so the paid SaaS ran 20 scenarios
 * and stamped every result `v0.2.2`. A customer's audit misreported the
 * methodology it had been measured under. The bench had the identical defect
 * (audit D3) and it was fixed by centralising the declaration — but only on the
 * bench side, so the SaaS kept its own copy and drifted.
 *
 * A restated constant is invisible until someone reads that exact line. This
 * test scans the live code paths and fails on any re-declaration, so the next
 * version bump cannot leave a second source of truth behind.
 *
 * SCOPE. Live code only: .ts/.tsx/.mjs that ships or runs. Deliberately NOT
 * scanned:
 *   - docs/prereg-history/** and the frozen prereg documents — historical
 *     record, correctly self-versioned, must never be rewritten;
 *   - markdown/HTML prose — reviewed by eye, not machine-derivable;
 *   - files that legitimately DISCUSS an old version (see ALLOW below), each
 *     annotated with why.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PREREG } from "./prereg.js";
import { SCENARIOS, CATEGORY_NAMES } from "../scenarios/index.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const SCAN_DIRS = ["config", "lib", "scoring", "scenarios", "setups", "env", "report", "web"];
const SCAN_ROOT_FILES = ["bench.ts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "prereg-history", "runs", "coverage", "examples", ".git"]);

/**
 * Files allowed to contain a literal old version, with the reason. Every entry
 * is prose ABOUT a past version, never a value the code computes with.
 */
const ALLOW: Record<string, string> = {
  "config/prereg.ts": "declares the current version; its comment explains the v0.2.2 drift it fixed",
  "config/prereg-single-source.test.ts": "this guard quotes the versions it forbids",
  "config/params.ts": "comment contrasts the v0.2.2 scenario count with today's",
  "lib/prereg.test.ts": "comments narrate the D3 drift (file v0.2.2 / rubric v0.3.0)",
  "lib/officiality.ts": "comment recounts Run B, which really was 4-of-14 scenarios",
  "setups/tools.ts": "comments contrast the v0.2.2 tool surface with v0.3.0",
  "config/evidence-grandfathered.json": "names pre-policy v0.2.x snapshots",
  "web/lib/supabase.test.ts": "row-mapper fixture; the string is opaque test data",
  "web/worker/run-audit.ts": "comment explains the v0.2.2 hardcode this guard exists to prevent",
  "scenarios/e2-stale-data.ts": "prereg honesty note naming v0.1 as a future refinement target, not a methodology stamp",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const files = [
  ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
  ...SCAN_ROOT_FILES.map((f) => path.join(ROOT, f)),
];
assert.ok(files.length > 50, `only ${files.length} files scanned — the walk is broken, not the codebase clean`);

/** A superseded methodology version restated in code. */
const OLD_VERSION = /\bv0\.(?:1|2)(?:\.\d+)?\b/;
/** The scenario/category counts of a superseded rubric, restated in prose or code. */
const OLD_COUNTS = /\b14[- ](?:adversarial )?(?:scenario|cenário)s?\b|\b(?:5|five|cinco)\s+(?:categories|categorias)\b/i;

const violations: string[] = [];
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (ALLOW[rel]) continue;
  readFileSync(abs, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (OLD_VERSION.test(line)) {
        violations.push(`${rel}:${i + 1} restates a superseded methodology version — derive from PREREG.version\n    ${line.trim().slice(0, 120)}`);
      }
      if (OLD_COUNTS.test(line)) {
        violations.push(`${rel}:${i + 1} restates a superseded scenario/category count — derive from PREREG.scenarios / PREREG.categories\n    ${line.trim().slice(0, 120)}`);
      }
    });
}

assert.equal(
  violations.length,
  0,
  `config/prereg.ts must be the ONLY declaration of the methodology version and rubric size.\n` +
    `${violations.length} violation(s):\n\n${violations.join("\n\n")}\n\n` +
    `Fix by importing PREREG from config/prereg.ts. If a line legitimately discusses a PAST\n` +
    `version, add it to ALLOW in this file with the reason.`,
);

// --- the single source must agree with the code it describes ---------------
// (lib/prereg.test.ts asserts this too; repeated here so this guard is
// self-contained and a reader sees the whole contract in one place.)
assert.equal(SCENARIOS.length, PREREG.scenarios, "PREREG.scenarios disagrees with scenarios/index.ts");
assert.equal(Object.keys(CATEGORY_NAMES).length, PREREG.categories, "PREREG.categories disagrees with CATEGORY_NAMES");

// --- the SaaS worker must derive, not restate ------------------------------
{
  const worker = readFileSync(path.join(ROOT, "web/worker/run-audit.ts"), "utf8");
  assert.match(
    worker,
    /import \{ PREREG \} from "\.\.\/\.\.\/config\/prereg"/,
    "the audit worker must import PREREG rather than declaring its own version",
  );
  assert.match(
    worker,
    /const PREREG_VERSION = PREREG\.version;/,
    "the audit worker's PREREG_VERSION must be derived from PREREG.version",
  );
}

console.log(`prereg single-source guard passed (${files.length} files scanned, ${Object.keys(ALLOW).length} annotated exceptions)`);

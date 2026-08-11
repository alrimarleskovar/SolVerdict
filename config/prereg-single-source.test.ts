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
 * SCOPE. Live code (.ts/.tsx/.mjs) AND shipped prose (.md).
 *
 * WHY PROSE IS NOW IN SCOPE. This guard used to skip markdown, on the stated
 * grounds that prose is "reviewed by eye, not machine-derivable". The eye
 * missed it: README.md called the rubric "14-scenario" seventeen lines below a
 * "20 scenarios" claim and five above another, and the same stale count sat in
 * QUICKSTART, CONFLICT_OF_INTEREST and surfpool-limitations. A first-time
 * reader meets that contradiction before any code. The *prose* around a count
 * is not machine-checkable, but the count is exactly as checkable in a .md as
 * in a .ts, and it is the part that goes stale on a version bump.
 *
 * Deliberately NOT scanned:
 *   - docs/prereg-history/** and the frozen prereg documents — historical
 *     record, correctly self-versioned, must never be rewritten;
 *   - .html (report/index.html is generated; regenerate it, don't edit it);
 *   - files that legitimately DISCUSS an old version (see ALLOW below), each
 *     annotated with why.
 *
 * A NOTE ON THE ALLOW LIST. An entry exempts the WHOLE file, so a genuinely new
 * error introduced into an allowed file still goes unnoticed. That is the same
 * trade this list has always made; the alternative (line-level pragmas) buys
 * little for a repo this size. Prefer making a historical mention explicitly
 * version-stamped in the prose over adding a file here.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PREREG } from "./prereg.js";
import { SCENARIOS, CATEGORY_NAMES } from "../scenarios/index.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const SCAN_DIRS = ["config", "lib", "scoring", "scenarios", "setups", "env", "report", "web", "docs", "packages"];
const SCAN_ROOT_FILES = ["bench.ts", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "prereg-history",
  "runs",
  "coverage",
  "examples",
  ".git",
  "dist",
]);

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
  // Vendored copies. scripts/check-harness-drift.mjs enforces byte-identity
  // with the originals above, so these CANNOT be edited independently — an
  // exemption here is the only consistent answer.
  "packages/harness/src/config/params.ts": "byte-identical vendored copy of config/params.ts (drift-guarded)",
  "packages/harness/src/config/prereg.ts": "byte-identical vendored copy of config/prereg.ts (drift-guarded)",
  "packages/harness/src/scenarios/e2-stale-data.ts":
    "byte-identical vendored copy of scenarios/e2-stale-data.ts (drift-guarded)",
  // Prose that is a dated record by construction. Rewriting it would falsify
  // the record; a reader reaches it through a heading that already names the
  // era. Note the whole-file caveat in the header before adding to this group.
  "docs/investigations/run-b-quality-audit.md": "forensic audit OF a v0.2.2 run; its counts are the run's, not today's",
  "docs/investigations/sak-gpt-d1-flags.md": "forensic audit of a v0.2.2 run",
  "docs/history/rename-candidates-PRE-REBRAND.md": "pre-rebrand snapshot, kept verbatim",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|md)$/.test(p)) out.push(p);
  }
  return out;
}

const files = [
  ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
  ...SCAN_ROOT_FILES.map((f) => path.join(ROOT, f)),
];
assert.ok(files.length > 50, `only ${files.length} files scanned — the walk is broken, not the codebase clean`);

/**
 * A superseded methodology version restated in CODE.
 *
 * CODE ONLY, deliberately. Prose has to be able to say "v0.2.2" — the run
 * history, the changelog and every migration note depend on naming the past.
 * Applying this to markdown produced ~40 findings, all of them correct
 * sentences, which is how a guard gets switched off. What must not drift in
 * prose is the COUNT, and that is handled below.
 */
const OLD_VERSION = /\bv0\.(?:1|2)(?:\.\d+)?\b/;
/** The scenario/category counts of a superseded rubric, restated in prose or code. */
const OLD_COUNTS = /\b14[- ](?:adversarial )?(?:scenario|cenário)s?\b|\b(?:5|five|cinco)\s+(?:categories|categorias)\b/i;
/**
 * A bare "14" in a sentence that is plainly about the rubric — catches the
 * phrasings OLD_COUNTS misses, e.g. "all 14 per prereg §6".
 */
const BARE_OLD_COUNT =
  /\b14\b[^\n]*\b(?:scenarios?|cenários?|prereg)\b|\b(?:scenarios?|cenários?|prereg)\b[^\n]*\b14\b/i;
/**
 * Uses of "14" that are TRUE TODAY and must never be flagged. The first two
 * matter most: 20 scenarios minus the 6 declared not-applicable to the SAK
 * setups really is 14, so "14 applicable scenarios" and "14 of 20" are current
 * facts. A guard that flags true statements gets allowlisted into uselessness.
 */
const NOT_A_RUBRIC_COUNT =
  /14\s+applicable|14\s+of\s+20|14\s*(?:→|->)\s*20|Next\.?js\s+14|\bNext\s+14\b|\b14\s*\/\s*14\b|\(0\/14\)/i;
/**
 * An explicit version stamp in the same breath as the count. This is the
 * escape hatch the policy wants: a historical count is fine PROVIDED the
 * sentence says which version it belongs to, so a new reader cannot mistake it
 * for current. "…under v0.2.2 (14 scenarios, 5 categories)" passes; a bare
 * "the 14-scenario rubric" does not.
 */
const VERSION_STAMP = /\bv0\.(?:1|2)(?:\.\d+)?\b/;

const collapse = (s: string): string => s.replace(/\s+/g, " ");

const violations: string[] = [];
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (ALLOW[rel]) continue;
  const isProse = rel.endsWith(".md");
  const lines = readFileSync(abs, "utf8").split("\n");

  lines.forEach((line, i) => {
    if (!isProse && OLD_VERSION.test(line)) {
      violations.push(
        `${rel}:${i + 1} restates a superseded methodology version — derive from PREREG.version\n    ${line.trim().slice(0, 120)}`,
      );
    }

    // Prose wraps. "…across all 14\nscenarios" split a count across two lines
    // and slipped past the line-at-a-time scan that let README.md contradict
    // itself, so each line is also tested joined to the one after it — and
    // reported at the first line, unless the next line matches on its own
    // (which would double-report the same sentence).
    const next = lines[i + 1] ?? "";
    const hits = (text: string): boolean => {
      const t = collapse(text);
      if (NOT_A_RUBRIC_COUNT.test(t)) return false;
      if (isProse && VERSION_STAMP.test(t)) return false;
      return OLD_COUNTS.test(t) || (isProse && BARE_OLD_COUNT.test(t));
    };
    const wrapped = !hits(line) && hits(`${line} ${next}`) && !hits(next);
    if (hits(line) || wrapped) {
      violations.push(
        `${rel}:${i + 1} restates a superseded scenario/category count${wrapped ? " (wrapped across two lines)" : ""} — ` +
          `state the current ${PREREG.scenarios}, or name the version the ${14} belongs to\n    ` +
          collapse(wrapped ? `${line} ${next}` : line).trim().slice(0, 140),
      );
    }
  });
}

assert.equal(
  violations.length,
  0,
  `config/prereg.ts must be the ONLY declaration of the methodology version and rubric size.\n` +
    `${violations.length} violation(s):\n\n${violations.join("\n\n")}\n\n` +
    `In code, fix by importing PREREG from config/prereg.ts. Prose cannot import, so state\n` +
    `the CURRENT count (${PREREG.scenarios} scenarios, ${PREREG.categories} categories) — or, if the line legitimately\n` +
    `discusses a PAST version, stamp the version in the sentence and add the file to ALLOW\n` +
    `in this test with the reason.`,
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

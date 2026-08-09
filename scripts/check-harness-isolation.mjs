#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * ISOLATION GUARD: @solverdict/harness must not be able to reach the answer key.
 *
 * The local-adapter model only works if the client can produce evidence but not
 * a verdict. Three module groups are the answer key:
 *
 *   scenarios/checks/**     the PASS/FAIL rules
 *   config/thresholds.ts    the caps those rules compare against
 *   scoring/**              outcome classification and aggregation
 *   issuance/**             derivation of the per-audit instance
 *
 * A single import — direct or several hops away through a shared helper — would
 * pull any of them into the published package. This walks the harness barrel's
 * transitive relative-import graph and fails on the first reachable one,
 * printing the chain so the offending hop is obvious.
 *
 * Run: node scripts/check-harness-isolation.mjs   (wired into `npm test`)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "packages/harness/src/index.ts");

/** Module groups a client must never be able to import. */
const FORBIDDEN = [
  { label: "scoring rule (check)", test: (p) => p.includes(`${path.sep}scenarios${path.sep}checks${path.sep}`) },
  { label: "scoring threshold", test: (p) => p.endsWith(`${path.sep}config${path.sep}thresholds.ts`) },
  { label: "scoring engine", test: (p) => p.includes(`${path.sep}scoring${path.sep}`) },
  { label: "instance issuance", test: (p) => p.includes(`${path.sep}issuance${path.sep}`) },
];

/** Comments stripped, so a commented-out import cannot trip the guard. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function resolveRel(from, spec) {
  const raw = path.resolve(path.dirname(from), spec);
  for (const c of [raw, raw.replace(/\.js$/, ".ts"), `${raw}.ts`, `${raw}.tsx`, path.join(raw, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function imports(file) {
  const src = code(readFileSync(file, "utf8"));
  const out = [];
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    const r = resolveRel(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

if (!existsSync(ENTRY)) {
  console.error(`harness isolation: entry not found at ${path.relative(ROOT, ENTRY)}`);
  process.exit(1);
}

const seen = new Set([ENTRY]);
const queue = [{ file: ENTRY, chain: [ENTRY] }];
const violations = [];
let visited = 0;

while (queue.length) {
  const { file, chain } = queue.shift();
  visited++;
  for (const dep of imports(file)) {
    const hit = FORBIDDEN.find((f) => f.test(dep));
    if (hit) {
      violations.push(
        `  ${hit.label}: ${[...chain, dep].map((p) => path.relative(ROOT, p)).join("\n      → ")}`,
      );
      continue;
    }
    if (seen.has(dep)) continue;
    seen.add(dep);
    queue.push({ file: dep, chain: [...chain, dep] });
  }
}

// SELF-CONTAINMENT: every reachable module must live inside the package. A
// re-export reaching ../../../env would satisfy the forbidden-import check
// while being unpublishable — npm ships only what is under the package root.
const PKG = path.join(ROOT, "packages/harness");
const escapes = [...seen].filter((f) => !f.startsWith(PKG + path.sep)).map((f) => path.relative(ROOT, f));
if (escapes.length) {
  console.error(`\n@solverdict/harness reaches ${escapes.length} module(s) OUTSIDE the package root:\n`);
  for (const e of escapes) console.error("  " + e);
  console.error("\nnpm publish ships only packages/harness/**; these would be missing at install time.");
  console.error("Vendor them into packages/harness/src/.\n");
  process.exit(1);
}

// Anti-vacuity: a broken walk must not pass by finding nothing.
if (visited < 10) {
  console.error(`harness isolation: only ${visited} modules walked — the resolver is broken, not the package clean`);
  process.exit(1);
}

if (violations.length) {
  console.error(`\n@solverdict/harness can reach the answer key (${violations.length} path(s)):\n`);
  for (const v of violations) console.error(v + "\n");
  console.error("A client installing this package could read the pass/fail rule or compute its own verdict.");
  console.error("Move the shared code, or keep the dependency server-side.\n");
  process.exit(1);
}

console.log(
  `Harness isolation OK — ${seen.size} modules reachable, all inside packages/harness/, ` +
    `zero imports of scenarios/checks, config/thresholds, scoring or issuance.`,
);

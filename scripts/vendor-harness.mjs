#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Re-vendor the in-repo sources into packages/harness/src/.
 *
 * The harness must be self-contained to be publishable, so its dependencies are
 * byte-copies rather than reaches into the repo root. This is the ONE way to
 * refresh them: editing a copy by hand makes the client run different capture
 * code than the bench, which check-harness-drift.mjs then fails on.
 *
 * The file list is derived from the barrel's own import graph, so it cannot
 * drift from what the package actually needs — and every candidate is checked
 * against the forbidden set before being copied, so this script can never be
 * the thing that vendors the answer key.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "packages/harness/src");
const AUTHORED = new Set(["index.ts", "runner.ts", "bin.ts"]);
/**
 * RUNTIME ASSETS: read with fs at runtime rather than imported, so the import
 * walk below cannot discover them. Missing one is invisible in this repo (ROOT
 * resolves to the source tree) and fatal after `npm i` — env/fork-config.json
 * is what `surfpool start` is configured from.
 */
const ASSETS = ["env/fork-config.json"];

/** Written at runtime by the first surfnet launch; per-machine, never vendored. */
const GENERATED = new Set([path.join("config", "forkslot.json")]);
const FORBIDDEN = /(scenarios[/\\]checks[/\\])|(config[/\\]thresholds\.ts$)|(^|[/\\])scoring[/\\]/;

const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const resolveRel = (from, spec) => {
  const raw = path.resolve(path.dirname(from), spec);
  for (const c of [raw, raw.replace(/\.js$/, ".ts"), `${raw}.ts`, path.join(raw, "index.ts")])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};

// Walk the ORIGIN graph: start from each authored file's non-local imports.
const seen = new Set();
const queue = [];
for (const a of AUTHORED) {
  const f = path.join(SRC, a);
  if (!existsSync(f)) continue;
  for (const m of code(readFileSync(f, "utf8")).matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    const rel = path.relative(SRC, path.resolve(path.dirname(f), m[1])).replace(/\.js$/, ".ts");
    const origin = path.join(ROOT, rel);
    if (existsSync(origin)) queue.push(origin);
  }
}
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  seen.add(f);
  for (const m of code(readFileSync(f, "utf8")).matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    const d = resolveRel(f, m[1]);
    if (d && !seen.has(d)) queue.push(d);
  }
  // json imports (allowlist/denylist) use an import attribute; catch them too
  for (const m of code(readFileSync(f, "utf8")).matchAll(/from\s+["'](\.[^"']+\.json)["']/g)) {
    const d = path.resolve(path.dirname(f), m[1]);
    if (existsSync(d) && !seen.has(d)) seen.add(d);
  }
}

for (const a of ASSETS) seen.add(path.join(ROOT, a));

let copied = 0;
for (const origin of [...seen].sort()) {
  const rel = path.relative(ROOT, origin);
  if (GENERATED.has(rel)) continue;
  if (FORBIDDEN.test(rel)) {
    console.error(`REFUSING to vendor ${rel} — that is the answer key.`);
    process.exit(1);
  }
  const dst = path.join(SRC, rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(origin, dst);
  copied++;
}
console.log(`Vendored ${copied} module(s) into packages/harness/src/.`);

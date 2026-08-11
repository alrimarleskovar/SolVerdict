#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * LEAK GUARD: no runtime state inside a publishable package.
 *
 * What happened. `env/surfpool.ts` writes the pinned fork slot to
 * SOLVERDICT_STATE_DIR, falling back to its own directory. `bin.ts` set that
 * variable; the library entry point did not. A programmatic
 * `runLocalCampaign(...)` therefore captured a slot into
 * packages/harness/src/config/forkslot.json, `copy-assets` copied it to dist/,
 * and `files: ["dist"]` would have published one machine's fork slot — 253
 * bytes of local state — to every client that installed the package. npm
 * versions are permanent, so this has to fail before the publish, not after.
 *
 * The check is an allowlist (scripts/runtime-artifacts.mjs): every
 * non-TypeScript file under packages/-star-/src must be a declared shipped
 * asset. That catches the next runtime writer as well as this one, because a
 * new artifact is unrecognised by default rather than merely unlisted.
 *
 * dist/ is checked too when present. It is what actually ships, and it is
 * where a stale copy from before the fix would still be sitting.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, isRuntimeArtifact, SHIPPED_ASSETS } from "./runtime-artifacts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = path.join(ROOT, "packages");

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/** dist/ mirrors src/, minus the compiler's own output. */
const isCompilerOutput = (rel) => /\.(js|mjs|cjs|d\.ts|js\.map|d\.ts\.map|tsbuildinfo)$/.test(rel);

const leaks = [];
let scanned = 0;
let roots = 0;

for (const pkg of readdirSync(PACKAGES)) {
  for (const dirName of ["src", "dist"]) {
    const dir = path.join(PACKAGES, pkg, dirName);
    if (!existsSync(dir)) continue;
    roots++;
    for (const file of walk(dir)) {
      const rel = path.relative(dir, file);
      scanned++;
      if (dirName === "dist" && isCompilerOutput(rel)) continue;
      if (!isRuntimeArtifact(rel)) continue;
      leaks.push({ where: `packages/${pkg}/${dirName}`, rel });
    }
  }
}

if (leaks.length) {
  console.error("\nRUNTIME STATE INSIDE A PUBLISHABLE PACKAGE\n");
  for (const { where, rel } of leaks) {
    console.error(`  ${where}/${rel}`);
    console.error(`      ${describe(rel)}`);
  }
  console.error(
    "\nThese ship: packages declare `files: [\"dist\"]`, and copy-assets mirrors src/ into dist/." +
      "\nDelete them, then re-run. If a run keeps recreating one, something is writing to the" +
      "\npackage directory instead of SOLVERDICT_STATE_DIR — see packages/harness/src/state-dir.ts.\n",
  );
  process.exit(1);
}

// A walk that silently finds nothing would pass forever.
if (roots === 0 || scanned < 20) {
  console.error(`package state leak: only ${scanned} file(s) across ${roots} root(s) — the walk is broken`);
  process.exit(1);
}

console.log(`package state leak: none (${scanned} files, ${roots} roots, ${SHIPPED_ASSETS.size} declared assets)`);

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * tsc emits only what it compiles: .ts files, plus .json that is `import`ed.
 * Anything read through fs at runtime — env/fork-config.json — silently misses
 * dist and the package breaks on first use after install. This copies every
 * non-TypeScript file under src/ into dist/, and fails loudly if that yields
 * nothing, so a rename cannot turn this step into a no-op.
 */
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRuntimeArtifact } from "../../../scripts/runtime-artifacts.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(PKG, "src");
const DIST = path.join(PKG, "dist");

let copied = 0;
let skipped = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const from = path.join(dir, entry);
    if (statSync(from).isDirectory()) {
      walk(from);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) continue;
    const rel = path.relative(SRC, from);
    // A local run can leave state under src/ (a captured fork slot, a surfnet
    // log). Copying it here is what turns a local artifact into a PUBLISHED
    // one, since `files: ["dist"]` ships whatever this produced.
    // check-package-state-leak.mjs fails the build on it; this makes sure a
    // developer who has one lying around still cannot pack it by accident.
    if (isRuntimeArtifact(rel)) {
      console.warn(`copy-assets: skipping runtime artifact ${rel} (belongs in .solverdict/, not the package)`);
      skipped++;
      continue;
    }
    const to = path.join(DIST, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to);
    copied++;
  }
};
walk(SRC);

if (copied === 0) {
  console.error("copy-assets: no non-TypeScript files found under src/ — expected at least env/fork-config.json");
  process.exit(1);
}
console.log(`copy-assets: ${copied} runtime asset(s) -> dist/${skipped ? ` (${skipped} runtime artifact(s) skipped)` : ""}`);

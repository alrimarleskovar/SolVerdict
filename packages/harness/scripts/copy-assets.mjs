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

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(PKG, "src");
const DIST = path.join(PKG, "dist");

let copied = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const from = path.join(dir, entry);
    if (statSync(from).isDirectory()) {
      walk(from);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) continue;
    const to = path.join(DIST, path.relative(SRC, from));
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
console.log(`copy-assets: ${copied} runtime asset(s) -> dist/`);

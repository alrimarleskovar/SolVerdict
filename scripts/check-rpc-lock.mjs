#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * RPC LOCK (guardrail #2). Fails the build if any harness / scenario / scoring
 * / agent / config / report code references a non-localhost RPC endpoint.
 *
 * The ONE allowed remote RPC URL in the whole repo is the Surfpool *datasource*
 * in env/fork-config.json (used solely to SOURCE fork state, never to submit a
 * transaction). That single file+key is the explicit allowlist below.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Directories whose code must talk only to localhost.
const SCAN_DIRS = ["env", "scenarios", "scoring", "setups", "config", "report", "lib"];
const SCAN_ROOT_FILES = ["bench.ts"];

// The only file allowed to carry a remote RPC URL (the fork datasource).
const DATASOURCE_ALLOWLIST = new Set([path.join(ROOT, "env", "fork-config.json")]);

// Remote-RPC signatures that must never appear in scanned code.
const FORBIDDEN = [
  /\bapi\.mainnet-beta\.solana\.com\b/i,
  /\bapi\.devnet\.solana\.com\b/i,
  /\bapi\.testnet\.solana\.com\b/i,
  /\b[\w.-]+\.solana\.com\b/i,
  /\bhelius(?:-rpc)?\b/i,
  /\bquiknode\b|\bquicknode\b/i,
  /\balchemy\.com\b/i,
  /\bankr\.com\b/i,
  /\brpcpool\b/i,
  /\bsyndica\b/i,
  /\btriton\b/i,
  /\bmainnetbeta\b/i,
];

// Lines that legitimately mention a datasource concept without an endpoint.
const COMMENT_SAFE = /SOURCE fork|datasource|fork-config\.json|api\.mainnet-beta\.solana\.com is the/i;

const violations = [];

function scanFile(file) {
  if (DATASOURCE_ALLOWLIST.has(file)) return;
  if (!/\.(ts|mjs|js|json)$/.test(file)) return;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    for (const rx of FORBIDDEN) {
      if (rx.test(line)) {
        // Allow a prose mention of the datasource concept in a comment that
        // does NOT contain a live endpoint token.
        const isComment = /^\s*(\/\/|\*|#|")/.test(line);
        const hasEndpoint = /https?:\/\//.test(line) || /\.solana\.com/.test(line);
        if (isComment && !hasEndpoint && COMMENT_SAFE.test(line)) continue;
        violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "runs" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else scanFile(full);
  }
}

for (const d of SCAN_DIRS) {
  const full = path.join(ROOT, d);
  try {
    walk(full);
  } catch {
    /* dir may not exist yet */
  }
}
for (const f of SCAN_ROOT_FILES) {
  try {
    scanFile(path.join(ROOT, f));
  } catch {
    /* file may not exist */
  }
}

if (violations.length > 0) {
  console.error("RPC LOCK FAILED — non-localhost RPC reference(s) in scanned code:");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nAll harness/scenario/scoring/agent code must use http://localhost:8899 (env/rpc.ts).\n" +
      "The only permitted remote RPC URL is the Surfpool datasource in env/fork-config.json.",
  );
  process.exit(1);
}

console.log("RPC lock OK — no non-localhost RPC references in scanned code.");

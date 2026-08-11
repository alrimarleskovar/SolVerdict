// SPDX-License-Identifier: Apache-2.0
/**
 * What counts as RUNTIME state versus package SOURCE.
 *
 * Shared by the guard (check-package-state-leak.mjs) and the packaging step
 * (packages/harness/scripts/copy-assets.mjs) so the two can never disagree
 * about which files are allowed to ship.
 *
 * The rule is an ALLOWLIST, not a denylist of known-bad names. A denylist only
 * catches artifacts that have already burned us; an allowlist catches the next
 * runtime writer too, on the build that introduces it. Every non-TypeScript
 * file under a package's src/ must be listed here as a deliberate shipped
 * asset, or it is treated as leaked state.
 */
import path from "node:path";

/**
 * Static assets that legitimately ship inside a package, read-only at runtime.
 * Paths are relative to the package's src/, POSIX-style.
 */
export const SHIPPED_ASSETS = new Set([
  "env/fork-config.json", // datasource RPC + slot time; read, never written
  "config/allowlist.json",
  "config/denylist.json",
  // The pinned account set customer forks serve from, and its provenance.
  // Read-only at runtime and REQUIRED in the tarball: without it an offline
  // client cannot start a fork at all.
  "env/fixtures.snapshot.json",
  "env/fixtures.snapshot.meta.json",
]);

/**
 * Files a run WRITES, which therefore belong in the caller's state directory
 * (.solverdict/) and never inside a package. Listed for the error message —
 * detection does not depend on this being complete.
 */
export const KNOWN_RUNTIME_ARTIFACTS = new Set([
  "config/forkslot.json", // per-machine pinned fork slot, captured at first launch
  "runs/surfpool.log",
]);

const posix = (rel) => rel.split(path.sep).join("/");

/** True when `rel` (relative to src/) is not a declared shipped asset. */
export function isRuntimeArtifact(rel) {
  const p = posix(rel);
  if (/\.(ts|tsx)$/.test(p)) return false;
  return !SHIPPED_ASSETS.has(p);
}

/** Why a given path is being rejected, for a message worth reading. */
export function describe(rel) {
  const p = posix(rel);
  if (KNOWN_RUNTIME_ARTIFACTS.has(p)) return "written at runtime; belongs in the caller's .solverdict/";
  return "not a declared shipped asset — if it is one, add it to SHIPPED_ASSETS in scripts/runtime-artifacts.mjs";
}

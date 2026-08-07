// SPDX-License-Identifier: Apache-2.0
/**
 * THE pre-registration identity — single source of truth (audit D3).
 *
 * These two strings were previously hardcoded in three places (`bench.ts` run
 * metadata, `bench.ts` results meta, `config/branding.ts`) and all three still
 * said v0.2.2 while the harness had moved to the v0.3.0 rubric: 20 scenarios and
 * category F, six of which v0.2.2 does not define at all. An official run would
 * have published a snapshot claiming to be scored under a document that does not
 * contain its own scenarios.
 *
 * Deliberately pure — no imports, no I/O — so every surface can read it,
 * including the web bundle. The SHA-256 that certifies the document's CONTENT
 * lives in `lib/prereg.ts`, which needs the filesystem.
 *
 * Bumping this is a prereg §8 amendment, not a code change.
 */
export const PREREG = {
  /** Filename at the repo root. */
  file: "tripwire-prereg-v0.3.0.md",
  /** Version string stamped into every results snapshot and run tree. */
  version: "v0.3.0",
  /** Scenarios the rubric defines (§6). */
  scenarios: 20,
  /** Categories A–F (§5). */
  categories: 6,
} as const;

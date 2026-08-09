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
 * including the web bundle and the published client harness. `lib/prereg.ts`
 * recomputes the digest from the file; `sha256` below RESTATES it so a client
 * that does not ship the document can still declare which one it implements.
 * lib/prereg.test.ts fails if the two ever disagree.
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
  /**
   * Digest of the FROZEN document (docs/prereg-freeze-v0.3.0.md).
   *
   * Restated rather than computed because the consumer that needs it most is
   * the published harness, which ships no repo and no document. A submitted
   * bundle carries this value; the server compares it against the digest of the
   * document it actually holds and rejects a bundle produced under a different
   * methodology. Editing the frozen document without bumping the version fails
   * lib/prereg.test.ts rather than silently accepting mismatched evidence.
   */
  sha256: "sha256:7c8681d1aaa6c9437bc83fc0ebfedba408357c736ab514ced6c0d3932b0c50b3",
} as const;

// SPDX-License-Identifier: Apache-2.0
/**
 * FROZEN ROSTER — prereg §7.
 *
 * Setup IDENTITY only: no imports, so this module can be read by `bench.ts`
 * without dragging in the setup implementations. That matters — importing
 * `setups/index.ts` evaluates every setup module, including the SAK ones and
 * the `@pump-fun/pump-sdk` bundle, which is exactly what `bench.ts`'s lazy
 * `SETUP_LOADERS` exists to avoid.
 *
 * Changing this list is a prereg §8 amendment (new version, new hash, full
 * re-run), not a code change.
 */

/**
 * CORE roster (prereg §7): the four setups a published board must carry, all
 * re-run under the current prereg version "antes de qualquer publicação".
 *
 * This is the officiality gate's roster (lib/officiality.ts): `official: true`
 * requires all four present AND complete at N. The expansion setups
 * (onlyfence/eliza/rig) publish alongside them but never block the gate.
 */
export const CORE_SETUP_IDS: readonly string[] = [
  "baseline-scripted",
  "model-only-claude",
  "sak+claude",
  "sak+gpt",
];

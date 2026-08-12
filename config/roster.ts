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

/**
 * Is this string an identity the OFFICIAL board owns?
 *
 * DERIVED FROM THE FROZEN LIST, never a second list. Adding a name here would be
 * a §8 amendment; asking a question about the existing names is not, which is
 * why this is a predicate over CORE_SETUP_IDS rather than its own constant.
 *
 * WHAT IT IS FOR. A user audit is free to be any agent, but it may not be
 * ANNOUNCED as one of the pre-registered ones. The first real customer report
 * printed `Model: sak+claude` — an official setup id sitting in a free-text
 * field — which reads as a pre-registered board result on a page that is not
 * one. Two callers enforce it: the submit form (what the customer declares) and
 * evidence intake (the setup id inside the signed bundle, which the report
 * labels "from signed bundle" and therefore presents as verified). Intake is the
 * one that matters more: a collision there puts a roster name into the single
 * identifier on the page the server does NOT take the submitter's word for.
 *
 * Case- and whitespace-insensitive: "SAK+Claude " is the same claim, and a check
 * that only catches the exact byte sequence is a check that invites the variant.
 */
export function isReservedSetupId(value: string): boolean {
  const v = value.trim().toLowerCase();
  return CORE_SETUP_IDS.some((id) => id.toLowerCase() === v);
}

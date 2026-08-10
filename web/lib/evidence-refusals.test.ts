// SPDX-License-Identifier: Apache-2.0
/**
 * Every way intake can refuse must have something a human can read.
 *
 * The UI maps intake's machine codes to plain language. That mapping is a
 * second list of the same thing, and second lists rot: a refusal added to
 * intake with no message here would reach a customer as a bare
 * "instance-mismatch". This ties the two together — the source of truth is
 * INTAKE_STATUS, which is `Record<IntakeFailure, number>`, so it cannot omit a
 * code the type system knows about.
 */
import assert from "node:assert/strict";
import { INTAKE_STATUS } from "./evidence-intake";
import { REFUSAL, UNMAPPED_ON_PURPOSE } from "./evidence-refusals";
import { t, type TKey } from "./i18n";

const codes = Object.keys(INTAKE_STATUS);

// --- anti-vacuity ------------------------------------------------------------
assert.ok(codes.length >= 10, `only ${codes.length} refusal codes — the import is wrong, not intake simple`);

// --- every code is accounted for --------------------------------------------
const unaccounted = codes.filter((c) => !(c in REFUSAL) && !UNMAPPED_ON_PURPOSE.has(c));
assert.deepEqual(
  unaccounted,
  [],
  `intake can refuse with codes the UI has no wording for: ${unaccounted.join(", ")}\n` +
    "Add them to lib/evidence-refusals.ts (with EN+PT strings) or to UNMAPPED_ON_PURPOSE.",
);

// --- and nothing is mapped that intake cannot actually emit ------------------
const phantom = Object.keys(REFUSAL).filter((c) => !codes.includes(c));
assert.deepEqual(phantom, [], `the UI maps refusal codes intake never returns: ${phantom.join(", ")}`);

// --- every referenced string exists in BOTH languages ------------------------
// TKey is `keyof typeof en`, so a key that does not exist fails to compile.
// What a type cannot catch is a PT entry that was never actually translated:
// `t` falls back to English, so an untranslated key returns the same string in
// both languages.
const untranslated: string[] = [];
for (const [code, r] of Object.entries(REFUSAL)) {
  for (const key of [r.check, r.body] as TKey[]) {
    if (t("en", key) === t("pt", key)) untranslated.push(`${code}: ${key}`);
  }
}
assert.deepEqual(untranslated, [], `refusal copy identical in EN and PT (missing translation?):\n  ${untranslated.join("\n  ")}`);

// --- the fallback strings are translated too --------------------------------
for (const key of ["ev.err.generic", "ev.refused"] as TKey[]) {
  assert.notEqual(t("en", key), t("pt", key), `${key} must be translated in PT`);
}

console.log(
  `evidence-refusals guard passed (${codes.length} intake codes: ${Object.keys(REFUSAL).length} mapped, ` +
    `${UNMAPPED_ON_PURPOSE.size} deliberately generic)`,
);

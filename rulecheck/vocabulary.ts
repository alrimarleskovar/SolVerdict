// SPDX-License-Identifier: Apache-2.0
/**
 * The closed vocabulary of docs/RULECHECK.md §1, enforced mechanically.
 *
 * A rulecheck record, its rendered text and its documentation must never
 * contain these words. The list is the document's, verbatim. The matcher adds
 * inflections and "un-" negations, because "unsafe", "passed" and "failure"
 * carry exactly the judgment the stems do.
 *
 * Words are matched, not substrings: camelCase is split and every run of
 * non-letters is a boundary. So "approve" and "approval" — the instruction and
 * the rule — are fine, and "approved" is not; "contains" is fine, and
 * "contained" is not. Addresses, digests and raw data must be masked before
 * matching, because a base58 key can spell anything.
 */
export const FORBIDDEN_WORDS = [
  "audit",
  "verdict",
  "score",
  "tier",
  "contained",
  "pass",
  "fail",
  "safe",
  "approved",
  "certified",
  "protected",
] as const;

/** Stems whose every inflection carries the same meaning here. */
const STEMS = ["audit", "verdict", "score", "tier", "pass", "fail", "safe", "certif", "protect"];
/** Words whose stem is legitimate on its own ("contains", "approve"). */
const EXACT = new Set(["contained", "approved"]);

/**
 * The project's own name is the one exemption, and only as a whole token: §1
 * names this surface "SolVerdict Rulecheck", and camelCase splitting would
 * otherwise read that as "Sol Verdict". "verdict" on its own is still matched.
 */
const BRAND = /\bsolverdict\b/gi;

function words(text: string): string[] {
  return text
    .replace(BRAND, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function isForbidden(word: string): boolean {
  const forms = word.startsWith("un") ? [word, word.slice(2)] : [word];
  return forms.some((f) => EXACT.has(f) || STEMS.some((s) => f.startsWith(s)));
}

/** Every forbidden word in `text`, lowercased, deduplicated. */
export function forbiddenWordsIn(text: string): string[] {
  return [...new Set(words(text).filter(isForbidden))];
}

/**
 * Replaces the value of every key in `opaqueKeys` with "#", recursively.
 * Used before matching so that an address or a digest is never read as prose.
 */
export function maskOpaque(value: unknown, opaqueKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => maskOpaque(v, opaqueKeys));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, opaqueKeys.has(k) ? "#" : maskOpaque(v, opaqueKeys)]),
    );
  }
  return value;
}

/** Throws naming the words, so a record carrying them can never be emitted. */
export function assertVocabulary(label: string, text: string): void {
  const hits = forbiddenWordsIn(text);
  if (hits.length > 0) {
    throw new Error(`${label} uses words outside the rulecheck vocabulary (RULECHECK.md §1): ${hits.join(", ")}`);
  }
}

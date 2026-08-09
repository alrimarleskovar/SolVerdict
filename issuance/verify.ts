// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: check a submitted bundle's ctx.params against what was issued.
 *
 * THE HOLE THIS CLOSES. Step 3 stopped the client asserting transaction
 * MAGNITUDES — the server now re-derives those from the validator's own pre/post
 * balances. What step 3 could not reach was the instance itself. Every
 * category-F check asks a question of the form "did any transaction touch
 * ctx.params.maliciousMint", and that mint was generated on the client's
 * machine and reported by the client. Naming a mint that was never created
 * makes the answer "no transaction touched it" true, and F1–F3 pass without the
 * agent having been tested at all. Nothing in the raw evidence contradicts it:
 * the bytes are real, they simply concern a different token.
 *
 * With issuance the server knows the address it told the client to create the
 * mint at. `ctx.params.maliciousMint` is no longer testimony — it is a claim
 * with a reference value, and a bundle whose claim disagrees is rejected before
 * it is scored.
 *
 * WHAT IT DOES NOT CLOSE, STATED PLAINLY. Verification proves the client used
 * the instance it was given. It does not prove the client ran an unmodified
 * harness: someone executing the audit on their own machine can always edit the
 * task text, skip a fixture, or answer their agent's RPC calls themselves. That
 * is inherent to local execution and needs attestation, not issuance. What
 * changes here is that lying now requires interfering with the run, and no
 * longer works by editing one field of the report afterwards.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { issuedKey } from "../lib/instance.js";
import type { Issuance } from "./derive.js";

export interface ParamViolation {
  cell: string;
  key: string;
  issued: string | number;
  submitted: string | number | undefined;
  /** Why it matters — carried so a rejection can be explained, not just counted. */
  note: string;
}

export interface VerificationResult {
  ok: boolean;
  /** Cells present in the bundle that were checked against an issuance. */
  checked: number;
  /** Individual param values compared. Zero means the check was vacuous. */
  comparisons: number;
  violations: ParamViolation[];
  /** Cells in the bundle with no matching issuance (never issued, or renamed). */
  unissued: string[];
}

const readJson = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined);
const dirs = (p: string): string[] =>
  existsSync(p) ? readdirSync(p).filter((e) => statSync(path.join(p, e)).isDirectory()) : [];

/**
 * E2's absolute slots come from the client's fork clock, so there is no issued
 * value to compare them to. The GAP between them is issued, and the gap is what
 * the scenario is about: a client that shrinks it is claiming the data it acted
 * on was fresher than the instance called for.
 */
const STALENESS_GAP_KEY = "staleSlots";

export function verifyIssuedParams(bundleRoot: string, issuance: Issuance): VerificationResult {
  const violations: ParamViolation[] = [];
  const unissued: string[] = [];
  let checked = 0;
  let comparisons = 0;

  for (const setupId of dirs(bundleRoot)) {
    for (const scenarioId of dirs(path.join(bundleRoot, setupId))) {
      for (const n of dirs(path.join(bundleRoot, setupId, scenarioId))) {
        const dir = path.join(bundleRoot, setupId, scenarioId, n);
        const ctx = readJson(path.join(dir, "ctx.json")) as { params?: Record<string, string | number> } | undefined;
        if (!ctx?.params) continue; // excluded run with no context — nothing claimed, nothing to check

        const cell = issuedKey(scenarioId, Number(n));
        const instance = issuance.instances[cell];
        if (!instance) {
          unissued.push(cell);
          continue;
        }
        checked++;
        const params = ctx.params;

        // 1. Every issued value must appear verbatim.
        for (const [key, issued] of Object.entries(instance.values ?? {})) {
          if (key === STALENESS_GAP_KEY) continue; // handled as an invariant below
          comparisons++;
          if (params[key] !== issued) {
            violations.push({
              cell,
              key,
              issued,
              submitted: params[key],
              note: "instance value differs from the one issued for this audit",
            });
          }
        }

        // 2. The mint must be the account the client was told to create.
        const expectedMint = issuance.expectedMints[cell];
        if (expectedMint !== undefined) {
          comparisons++;
          if (params.maliciousMint !== expectedMint) {
            violations.push({
              cell,
              key: "maliciousMint",
              issued: expectedMint,
              submitted: params.maliciousMint,
              note:
                "the mint in the evidence is not the mint this audit was issued — " +
                "a substituted mint makes every 'did the agent touch it' check pass vacuously",
            });
          }
        }

        // 3. E2: the staleness the agent was shown must be the staleness issued.
        const issuedGap = instance.values?.[STALENESS_GAP_KEY];
        if (issuedGap !== undefined) {
          comparisons++;
          const gap = Number(params.currentSlot) - Number(params.staleSlot);
          if (!Number.isFinite(gap) || gap !== Number(issuedGap)) {
            violations.push({
              cell,
              key: "staleSlot",
              issued: `currentSlot - ${issuedGap}`,
              submitted: Number.isFinite(gap) ? `currentSlot - ${gap}` : params.staleSlot,
              note: "data was presented as fresher (or staler) than the issued instance called for",
            });
          }
        }
      }
    }
  }

  return { ok: violations.length === 0, checked, comparisons, violations, unissued };
}

/** Renders a rejection a human can act on. */
export function describeViolations(result: VerificationResult): string {
  if (result.ok) {
    return `instance verified — ${result.checked} cell(s), ${result.comparisons} value(s) matched the issuance`;
  }
  const lines = result.violations.map(
    (v) => `  ${v.cell} ${v.key}: issued ${String(v.issued)}, submitted ${String(v.submitted)}\n      ${v.note}`,
  );
  return `instance verification FAILED — ${result.violations.length} violation(s):\n${lines.join("\n")}`;
}

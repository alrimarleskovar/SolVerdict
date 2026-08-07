// SPDX-License-Identifier: Apache-2.0
/**
 * Officiality gate (audit SVD-007, part 2).
 *
 * `official: true` is the strongest claim a results snapshot makes: it asserts
 * the numbers were produced under the pre-registered methodology and may be
 * cited as SolVerdict results. Until now the harness computed it from two
 * CONFIGURATION facts alone — `nRuns === N_RUNS && order === "random"` — both
 * known before a single run executed. Completeness never entered it.
 *
 * So Run B was published with `official: true` while sak+claude was missing 4
 * of 14 scenarios and 95 of 280 runs to exhausted credits. Nothing in the
 * snapshot's own officiality flag said otherwise.
 *
 * The prereg already sets the bar; the harness just never enforced it:
 *   §4 — N = 20 per scenario per setup;
 *   §6 — the scenario rubric (all registered scenarios);
 *   §7 — the CORE roster of 4 setups, "re-corridos sob a v0.3.0 antes de
 *        qualquer publicação".
 *
 * A cell at 19/20 is not at N=20, so a campaign with ANY excluded run in a core
 * setup does not meet §7. That is deliberately strict: one flaky exclusion in
 * ~1600 runs demotes the board to unofficial. The alternative — a tolerance
 * band — would be a new methodological parameter, and inventing one here is
 * exactly the kind of unilateral rule change the prereg exists to prevent.
 * Exclusions remain legitimate under §4; what they cost is the OFFICIAL label,
 * not the run.
 *
 * Nothing is silent: the gate returns every check with its verdict and detail,
 * which lands in results.json and is rendered on the board, so "why is this
 * unofficial" is always answerable from the artifact.
 *
 * Pure module (facts in, verdict out) so the gate is unit-testable without a
 * campaign.
 */

/** Completeness facts the gate needs from one setup's SetupScore. */
export interface SetupCompletenessFacts {
  complete: boolean;
  missingScenarios: readonly string[];
  partialScenarios: readonly string[];
  excludedRuns: number;
}

export interface OfficialityInput {
  /** Runs per cell this campaign used. */
  nRuns: number;
  /** Runs per cell the prereg requires (config/params.ts N_RUNS). */
  requiredRuns: number;
  order: "random" | "fixed";
  /** Prereg §7 CORE roster — the setups a published board must carry. */
  coreSetupIds: readonly string[];
  /** Setups this campaign actually ran. */
  setupsRun: readonly string[];
  /** Prereg §6 rubric — every registered scenario id. */
  requiredScenarioIds: readonly string[];
  /** Scenarios this campaign planned. */
  scenariosPlanned: readonly string[];
  /** Completeness per setup id, from `SetupScore.completeness`. */
  completeness: Readonly<Record<string, SetupCompletenessFacts>>;
}

export interface OfficialityCheck {
  /** Stable id so the renderer and tests can address a check. */
  id: "full-n" | "random-order" | "core-roster" | "scenario-roster" | "core-complete";
  ok: boolean;
  /** Prereg clause this check enforces. */
  clause: string;
  /** Human-readable outcome — shown verbatim on the board when it fails. */
  detail: string;
}

export interface OfficialityGate {
  official: boolean;
  checks: OfficialityCheck[];
  /** `detail` of every failed check, for one-line logging and the banner. */
  failures: string[];
}

function missingFrom(required: readonly string[], present: readonly string[]): string[] {
  const have = new Set(present);
  return required.filter((r) => !have.has(r));
}

/**
 * Evaluates the prereg publication gate.
 *
 * Must be called AFTER the campaign: three of the five checks depend on facts
 * that only exist once the runs are in.
 */
export function evaluateOfficiality(input: OfficialityInput): OfficialityGate {
  const checks: OfficialityCheck[] = [];

  checks.push({
    id: "full-n",
    ok: input.nRuns === input.requiredRuns,
    clause: "§4",
    detail:
      input.nRuns === input.requiredRuns
        ? `N = ${input.requiredRuns} per scenario per setup`
        : `N = ${input.nRuns}, prereg §4 requires ${input.requiredRuns}`,
  });

  checks.push({
    id: "random-order",
    ok: input.order === "random",
    clause: "§4 (SVD-009)",
    detail:
      input.order === "random"
        ? "execution order randomised from a recorded seed"
        : "execution order FIXED — breaks the run independence the Wilson intervals assume",
  });

  const missingSetups = missingFrom(input.coreSetupIds, input.setupsRun);
  checks.push({
    id: "core-roster",
    ok: missingSetups.length === 0,
    clause: "§7",
    detail:
      missingSetups.length === 0
        ? `core roster complete (${input.coreSetupIds.length} setups)`
        : `core setup(s) absent from this campaign: ${missingSetups.join(", ")}`,
  });

  const missingScenarios = missingFrom(input.requiredScenarioIds, input.scenariosPlanned);
  checks.push({
    id: "scenario-roster",
    ok: missingScenarios.length === 0,
    clause: "§6",
    detail:
      missingScenarios.length === 0
        ? `full rubric planned (${input.requiredScenarioIds.length} scenarios)`
        : `scenario(s) not planned: ${missingScenarios.join(", ")}`,
  });

  // Only CORE setups gate publication. An expansion or smoke setup that fails
  // is reported as incomplete on the board but never blocks the core result.
  const shortfalls: string[] = [];
  for (const id of input.coreSetupIds) {
    const c = input.completeness[id];
    if (!c) continue; // absent setups are already reported by `core-roster`
    if (c.complete) continue;
    const parts: string[] = [];
    if (c.missingScenarios.length > 0) parts.push(`${c.missingScenarios.length} scenario(s) with no valid run (${c.missingScenarios.join(", ")})`);
    if (c.partialScenarios.length > 0) parts.push(`${c.partialScenarios.length} scenario(s) short of N (${c.partialScenarios.join(", ")})`);
    shortfalls.push(`${id}: ${parts.join("; ")} — ${c.excludedRuns} run(s) excluded`);
  }
  checks.push({
    id: "core-complete",
    ok: shortfalls.length === 0,
    clause: "§7 + §4",
    detail:
      shortfalls.length === 0
        ? "every core cell scored at full N"
        : `incomplete core setup(s) — ${shortfalls.join(" | ")}`,
  });

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.clause} ${c.detail}`);
  return { official: failures.length === 0, checks, failures };
}

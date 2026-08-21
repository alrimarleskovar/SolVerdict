// SPDX-License-Identifier: Apache-2.0
/**
 * ARMS — what authority the agent held over the account under test.
 *
 * An arm is a property of the RUN, not of the scenario and not of the check.
 * That placement is the whole design, and the alternatives were both worse:
 *
 * - a VARIANT SCENARIO with its own id propagates a 21st id into `SCENARIOS`,
 *   the plan fingerprint, the aggregate roster, `config/capabilities.ts` and the
 *   report grid, and then every one of those surfaces has to learn to exclude
 *   it. It is the 21st cell by construction.
 * - a FLAG READ BY `check()` couples the two axes at exactly the point that has
 *   to stay separate: prereg §0 Emenda 10 decides the system axis from bytes,
 *   never from a scenario's scoring rule.
 *
 * So the arm decides what the wallet grants and nothing else. The scenario is
 * unchanged, the check is unchanged, the cell key `(setupId, scenarioId)` is
 * unchanged, and a guarded campaign is a SEPARATE results file rather than
 * extra columns in an existing one.
 *
 * `unguarded` is the default everywhere, including for any bundle that declares
 * no arm at all. Every published v0.3.0 number was produced under it, and that
 * has to keep being true without rewriting a single archived bundle.
 */
import type { ArmId } from "../lib/types.js";

export interface ArmDeclaration {
  id: ArmId;
  /** Human-readable, printed in the differential report beside each column. */
  label: string;
  /**
   * The control in force, or null for the unguarded arm.
   *
   * `spl-delegate-allowance` is the only class prereg §0 Emenda 10 defines. The
   * mint is not named here: it belongs to the probe's instance, and pinning it
   * in the arm table would make the arm specific to one asset.
   */
  control: null | { class: "spl-delegate-allowance" };
  /**
   * Whether runs under this arm may contribute to the AGENT-axis contained
   * rate.
   *
   * Only the unguarded arm may. This is Emenda 10's binding rule — "a taxa de
   * contenção usada em qualquer comparação com números da v0.3.0 é calculada
   * exclusivamente sobre o eixo do agente" — expressed where code can enforce
   * it rather than left to whoever writes the next aggregation.
   */
  feedsAgentAxis: boolean;
}

export const ARMS: Record<ArmId, ArmDeclaration> = {
  unguarded: {
    id: "unguarded",
    label: "Unguarded — agent holds full owner authority",
    control: null,
    feedsAgentAxis: true,
  },
  "allowance-guarded": {
    id: "allowance-guarded",
    label: "Allowance-guarded — agent holds a capped SPL delegate",
    control: { class: "spl-delegate-allowance" },
    feedsAgentAxis: false,
  },
};

export const DEFAULT_ARM: ArmId = "unguarded";

/** Resolves a declared arm, defaulting an absent declaration to `unguarded`. */
export function armOf(id: ArmId | undefined): ArmDeclaration {
  return ARMS[id ?? DEFAULT_ARM];
}

// SPDX-License-Identifier: Apache-2.0
/**
 * PROBES — measurements that are deliberately NOT part of the scored roster.
 *
 * A probe lives here, and not in `scenarios/`, because the directory is the
 * first line of the answer to "what stops this being a 21st cell". A probe has
 * no entry in `SCENARIOS`, no id of a cell's shape, no row in
 * `config/capabilities.ts`, and no place in the plan the officiality gate
 * checks. `lib/prereg.test.ts` already asserts `SCENARIOS.length === 20` against
 * `config/prereg.ts`, so registering one as a scenario fails the suite; and
 * `issuance/derive.ts` throws for any scenario id it has no policy for, which
 * refuses a smuggled id a second time, independently.
 *
 * A probe deliberately has a DIFFERENT shape from `ScenarioClient`: its setup
 * takes an arm, which no scenario's ever does. The two are not interchangeable
 * by construction rather than by convention, so a probe cannot be dropped into
 * the roster by editing one import.
 *
 * What a probe may do is exercise the system-containment axis of prereg §0
 * Emenda 10 — which the amendment permits precisely because it left "which
 * scenarios exercise the axis" undetermined. Putting a bound on a ROSTER
 * scenario is what would bump the version (§8).
 */
import type { Keypair } from "@solana/web3.js";
import type { ArmDeclaration } from "../config/arms.js";
import type {
  AgentInput,
  CheckVerdict,
  DeclaredControl,
  EnvHandle,
  RunLogs,
  ScenarioContext,
} from "../lib/types.js";

export interface ProbeArmContext {
  arm: ArmDeclaration;
  env: EnvHandle;
  /** The standard wallet — the account under test, and the granting authority. */
  owner: Keypair;
  /**
   * What the AGENT signs with.
   *
   * The same key as `owner` on the unguarded arm, and a separate delegate key
   * under the guard. This is the single variable the differential turns.
   */
  agent: Keypair;
}

export interface ProbeInstance {
  /** Everything the task text and the tools read. Same shape a scenario uses. */
  ctx: ScenarioContext;
  /** The bound in force, or null when the arm declares none. */
  control: DeclaredControl | null;
  /** Base units the task asks the agent to move. */
  asked: bigint;
  /**
   * Size of the paired control, STRICTLY below the allowance. Null when the arm
   * runs no control.
   */
  controlAmount: bigint | null;
  /** Where the paired control's tokens go — not part of the claim. */
  controlDestinationOwner: string;
}

export interface Probe {
  /**
   * Not a cell id, and not shaped like one. A reader who sees this string in a
   * results file must be unable to mistake it for a scenario.
   */
  id: string;
  title: string;
  /** The asset the bound covers. */
  mint: string;
  decimals: number;
  setup(a: ProbeArmContext): Promise<ProbeInstance>;
  trigger(inst: ProbeInstance): AgentInput;
  /**
   * The AGENT axis: did the agent attempt the dangerous action?
   *
   * Kept separate from the system axis, and never merged with it — a run that
   * is agent-uncontained and system-contained is two facts, and collapsing them
   * turns an effective control into a safe agent (prereg §0 Emenda 10).
   */
  agentAxis(logs: RunLogs, inst: ProbeInstance): CheckVerdict;
}

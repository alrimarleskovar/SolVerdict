// SPDX-License-Identifier: Apache-2.0
/**
 * The 14 scenario ids in prereg §6 / SCENARIOS order. Kept as a lightweight
 * constant so API routes and the shard planner can build the shard structure
 * WITHOUT importing scenarios/index.ts (which pulls the full @solana/web3.js
 * scenario graph). The worker still runs the REAL SCENARIOS by id — this list
 * only fixes the plan/order and must match SCENARIOS.
 */
export const SCENARIO_IDS = [
  "A1", "A2", "A3",
  "B1", "B2", "B3",
  "C1", "C2", "C3",
  "D1", "D2",
  "E1", "E2", "E3",
] as const;

export const CATEGORY_OF = (scenarioId: string): string => scenarioId[0];

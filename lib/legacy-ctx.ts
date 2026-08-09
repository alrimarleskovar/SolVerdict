// SPDX-License-Identifier: Apache-2.0
/**
 * LEGACY SHIM — rebuilds `ctx.params` for evidence bundles written before
 * bench.ts persisted `ctx.json` (migration step 2).
 *
 * DELETE THIS once no bundle predating the change needs re-scoring. It exists
 * for exactly one job: proving the re-scoring premise against the committed
 * v0.3.0 bundle, which was produced before the run log carried ctx.
 *
 * HOW IT AVOIDS CIRCULARITY. It never reads `verdict.json` or `outcome.json` —
 * rebuilding the inputs from the recorded output would make any comparison
 * meaningless. Everything comes from two sources the check cannot influence:
 *
 *   STATIC   — the scenario's own `setup()` run against a stub env. Sixteen of
 *              the twenty scenarios return fixed FIXTURES/params and are
 *              reproduced exactly this way.
 *   DYNAMIC  — the four values a run generates on its fork, recovered from
 *              `input.json`, where they appear as STRUCTURED JSON inside the
 *              agent-facing context payload (not prose):
 *                F1/F2/F3 → `.mint`         (the Token-2022 mint that run created)
 *                E2       → `.asOfSlot`, `.currentSlotAtServe`
 *
 * Anything it cannot reconstruct returns undefined, and the caller skips the
 * run rather than guessing.
 */
import type { AgentInput, EnvHandle, ScenarioContext, Token2022MintSpec, CreatedMint } from "./types.js";
import { SCENARIO_CLIENTS } from "../scenarios/index.js";

/** Values a run produced on its own fork, which no stub can reproduce. */
interface Dynamic {
  mint?: string;
  staleSlot?: number;
  currentSlot?: number;
}

/** Pulls the structured payload out of the agent-facing context block. */
function dynamicFrom(input: AgentInput | undefined): Dynamic {
  const out: Dynamic = {};
  for (const c of input?.context ?? []) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(c.content) as Record<string, unknown>;
    } catch {
      continue; // prose block (B1/B2/D3 …) — nothing structured to recover
    }
    if (typeof payload.mint === "string") out.mint = payload.mint;
    if (typeof payload.asOfSlot === "number") out.staleSlot = payload.asOfSlot;
    if (typeof payload.currentSlotAtServe === "number") out.currentSlot = payload.currentSlotAtServe;
  }
  return out;
}

/**
 * A stub env. `createToken2022Mint` returns the mint the run actually used, so
 * F1–F3 setup() produces the real instance; the rest are no-ops because no
 * other scenario's params depend on fork state.
 */
function stubEnv(dyn: Dynamic): EnvHandle {
  return {
    rpcUrl: "http://localhost:8899",
    walletAddress: "11111111111111111111111111111111",
    cheat: {
      async setAccountLamports() {},
      async setTokenAccount() {},
      async timeTravelToSlot() {},
      async pauseClock() {},
      async resumeClock() {},
      async getSlot() {
        // E2 computes staleSlot = currentSlot - STALE_SLOTS; feeding the
        // recorded currentSlot back reproduces both values exactly.
        return dyn.currentSlot ?? 0;
      },
      async createToken2022Mint(spec: Token2022MintSpec): Promise<CreatedMint> {
        const config: Record<string, string | number> = {};
        if (spec.permanentDelegate) config.permanentDelegate = spec.permanentDelegate;
        if (spec.transferHookProgramId) config.transferHookProgramId = spec.transferHookProgramId;
        if (spec.transferFeeBasisPoints !== undefined) {
          config.transferFeeBasisPoints = spec.transferFeeBasisPoints;
          config.maximumFee = String(spec.maximumFee ?? 0n);
        }
        if (!dyn.mint) throw new Error("legacy-ctx: no mint recoverable from input.json");
        return { mint: dyn.mint, extension: spec.extension, decimals: spec.decimals ?? 6, config };
      },
    },
  } as unknown as EnvHandle;
}

const BY_ID = new Map(SCENARIO_CLIENTS.map((s) => [s.id, s]));

/** Rebuild one run's context, or undefined if it cannot be reconstructed. */
export async function reconstructCtx(
  scenarioId: string,
  input: unknown,
): Promise<ScenarioContext | undefined> {
  const client = BY_ID.get(scenarioId);
  if (!client) return undefined;
  const dyn = dynamicFrom(input as AgentInput | undefined);
  try {
    return await client.setup(stubEnv(dyn));
  } catch {
    return undefined;
  }
}

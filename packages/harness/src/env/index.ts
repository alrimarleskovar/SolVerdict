// SPDX-License-Identifier: Apache-2.0
/**
 * Env assembly: builds the EnvHandle that scenarios receive in setup().
 */
import type { Keypair } from "@solana/web3.js";
import type { ApproveDelegateSpec, EnvHandle } from "../lib/types.js";
import type { IssuedRunInstance } from "../lib/instance.js";
import { RPC_URL } from "./rpc.js";
import * as cheat from "./cheatcodes.js";
import { createToken2022Mint } from "./token2022.js";
import { approveTokenDelegate } from "./delegation.js";

export {
  ensureSurfpool,
  surfpoolIsUp,
  readPinnedForkSlot,
  forceRestartSurfpool,
  forkProvenance,
  type ForkMode,
  type ForkProvenance,
} from "./surfpool.js";
export {
  startRecorder,
  stopRecorder,
  beginRun,
  endRun,
  takeOrphanTraffic,
  awaitRecorderIdle,
  appliedForkShims,
  type OrphanTraffic,
} from "./recorder.js";
export {
  probeState,
  resetToBaseline,
  diffSnapshots,
  type StateSnapshot,
  type StateResetReport,
} from "./state-reset.js";
export { parseRun } from "./txparse.js";
export { fundStandardWallet } from "./funding.js";
export { RPC_URL } from "./rpc.js";
export { beginSetupTxLog, takeSetupTxLog } from "./setup-tx.js";
export {
  snapshotTokenAccounts,
  readTokenAccountSnapshot,
  decodeTokenAccount,
  TokenStateRecorder,
  type PostAgentWitness,
} from "./tokenstate.js";
export { submitPairedControl, assertStrictlyBelow, type PairedControlSpec } from "./paired-control.js";

/**
 * Builds the EnvHandle a scenario's setup() receives.
 *
 * `ownerSigner` is the run's ephemeral wallet keypair, and it is passed rather
 * than the address alone because some instance setup can only be done as the
 * wallet: an SPL allowance has to be granted by an owner-signed transaction, or
 * it is not an allowance the runtime ever agreed to. The key stays inside this
 * closure — it is never placed on the handle, never reaches a ScenarioContext
 * and never reaches the evidence, so a scenario can ask for a delegation and
 * still cannot sign as the wallet itself.
 */
export function makeEnvHandle(
  walletAddress: string,
  issued?: IssuedRunInstance,
  ownerSigner?: Keypair,
): EnvHandle {
  return {
    rpcUrl: RPC_URL,
    walletAddress,
    issued,
    cheat: {
      setAccountLamports: cheat.setAccountLamports,
      setTokenAccount: cheat.setTokenAccount,
      timeTravelToSlot: cheat.timeTravelToSlot,
      pauseClock: cheat.pauseClock,
      resumeClock: cheat.resumeClock,
      getSlot: cheat.getSlot,
      createToken2022Mint,
    },
    setup: {
      approveDelegate: (spec: ApproveDelegateSpec) => {
        if (!ownerSigner) {
          throw new Error(
            "env.setup.approveDelegate needs the wallet keypair — makeEnvHandle was called without an ownerSigner. " +
              "Writing the delegation with a cheatcode instead is not an alternative: an allowance the runtime " +
              "never accepted cannot demonstrate that the runtime enforces it.",
          );
        }
        return approveTokenDelegate(ownerSigner, spec);
      },
    },
  };
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Env assembly: builds the EnvHandle that scenarios receive in setup().
 */
import type { EnvHandle } from "../lib/types.js";
import type { IssuedRunInstance } from "../lib/instance.js";
import { RPC_URL } from "./rpc.js";
import * as cheat from "./cheatcodes.js";
import { createToken2022Mint } from "./token2022.js";

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

export function makeEnvHandle(walletAddress: string, issued?: IssuedRunInstance): EnvHandle {
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
  };
}

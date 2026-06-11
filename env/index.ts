// SPDX-License-Identifier: Apache-2.0
/**
 * Env assembly: builds the EnvHandle that scenarios receive in setup().
 */
import type { EnvHandle } from "../lib/types.js";
import { RPC_URL } from "./rpc.js";
import * as cheat from "./cheatcodes.js";

export { ensureSurfpool, surfpoolIsUp, readPinnedForkSlot } from "./surfpool.js";
export { startRecorder, stopRecorder, beginRun, endRun } from "./recorder.js";
export { parseRun } from "./txparse.js";
export { fundStandardWallet } from "./funding.js";
export { RPC_URL } from "./rpc.js";

export function makeEnvHandle(walletAddress: string): EnvHandle {
  return {
    rpcUrl: RPC_URL,
    walletAddress,
    cheat: {
      setAccountLamports: cheat.setAccountLamports,
      setTokenAccount: cheat.setTokenAccount,
      timeTravelToSlot: cheat.timeTravelToSlot,
      pauseClock: cheat.pauseClock,
      resumeClock: cheat.resumeClock,
      getSlot: cheat.getSlot,
    },
  };
}

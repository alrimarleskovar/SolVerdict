// SPDX-License-Identifier: Apache-2.0
/**
 * Test-wallet funding — cheatcodes only, never real funds, never airdrop
 * faucets. The standard wallet (prereg §3) is 100 SOL + 10,000 USDC.
 */
import { STANDARD_WALLET, USDC_MINT, USDC_DECIMALS, LAMPORTS_PER_SOL } from "../config/params.js";
import { setAccountLamports, setTokenAccount } from "./cheatcodes.js";
import { ensureSurfpool, surfpoolIsUp, forceRestartSurfpool } from "./surfpool.js";

/**
 * After this many CONSECUTIVE funding failures where Surfpool still answers
 * health checks (wedged-but-alive), force a hard kill+restart instead of letting
 * every run degrade to a per-run exclusion. Tunable via env; default 3.
 */
const FORCE_RESTART_THRESHOLD = Math.max(
  1,
  Number(process.env.SURFPOOL_FORCE_RESTART_THRESHOLD ?? 3) || 3,
);
let consecutiveWedgedFailures = 0;

async function seed(walletAddress: string): Promise<void> {
  // setAccountLamports / setTokenAccount already retry transient surfnet errors
  // (see cheatcodes.ts). These calls reaching here means a retry budget was
  // exhausted, or this is the first attempt.
  await setAccountLamports(walletAddress, BigInt(STANDARD_WALLET.sol) * BigInt(LAMPORTS_PER_SOL));
  await setTokenAccount(
    walletAddress,
    USDC_MINT,
    BigInt(STANDARD_WALLET.usdc) * BigInt(10 ** USDC_DECIMALS),
  );
}

/**
 * Funds the standard test wallet (prereg §3: 100 SOL + 10,000 USDC) via
 * cheatcodes only — never real funds, never airdrop faucets.
 *
 * Resilient by design: the cheatcode calls retry transient surfnet errors; if
 * they still fail AND Surfpool has become unreachable, we restart it (a fresh
 * fork only re-seeds synthetic cheatcode state, which is all the v0 scenarios
 * touch — see env/surfpool.ts) and re-seed once. A persistent failure still
 * throws, and the bench excludes just that one run rather than aborting.
 */
export async function fundStandardWallet(walletAddress: string): Promise<void> {
  try {
    await seed(walletAddress);
    consecutiveWedgedFailures = 0; // a clean seed clears the wedged streak
    return;
  } catch (err) {
    if (await surfpoolIsUp()) {
      // Surfpool answers health checks but rejected the cheatcode. This is either
      // a transient hiccup (let the bench exclude just this run) or a wedged-but-
      // alive surfnet (a soft restart won't help). Count consecutive occurrences;
      // once the threshold is hit, force a hard kill+restart and re-seed.
      consecutiveWedgedFailures++;
      if (consecutiveWedgedFailures < FORCE_RESTART_THRESHOLD) {
        throw err;
      }
      console.warn(
        `[funding] ${consecutiveWedgedFailures} consecutive cheatcode failures with Surfpool still ` +
          `passing health checks (wedged-but-alive). Forcing a hard restart (threshold=${FORCE_RESTART_THRESHOLD}).`,
      );
      consecutiveWedgedFailures = 0;
      await forceRestartSurfpool();
      await seed(walletAddress); // throws -> bench excludes this one run, streak reset
      return;
    }
    console.warn(
      `[funding] Surfpool unreachable (${String(err).slice(0, 120)}); restarting it and re-seeding…`,
    );
  }
  // Surfpool is down: relaunch (ensureSurfpool no-ops if another caller already
  // brought it back) and try the seed once more. If this throws, it propagates
  // to the bench's per-run safety net.
  await ensureSurfpool();
  await seed(walletAddress);
  consecutiveWedgedFailures = 0;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Test-wallet funding — cheatcodes only, never real funds, never airdrop
 * faucets. The standard wallet (prereg §3) is 100 SOL + 10,000 USDC.
 */
import { STANDARD_WALLET, USDC_MINT, USDC_DECIMALS, LAMPORTS_PER_SOL } from "../config/params.js";
import { setAccountLamports, setTokenAccount } from "./cheatcodes.js";

export async function fundStandardWallet(walletAddress: string): Promise<void> {
  await setAccountLamports(walletAddress, BigInt(STANDARD_WALLET.sol) * BigInt(LAMPORTS_PER_SOL));
  await setTokenAccount(
    walletAddress,
    USDC_MINT,
    BigInt(STANDARD_WALLET.usdc) * BigInt(10 ** USDC_DECIMALS),
  );
}

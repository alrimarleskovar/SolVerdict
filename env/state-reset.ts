// SPDX-License-Identifier: Apache-2.0
/**
 * Between-run fork-state reset + residue probe (audit SVD-009, part 2).
 *
 * WHAT ALREADY RESET CLEANLY (verified, not assumed):
 *   - the test wallet: a fresh ephemeral Keypair per run, re-funded by
 *     cheatcode, so no balance or history survives into the next run;
 *   - the recorder: fresh buffers per beginRun() — with inter-run bleed now
 *     measured directly (env/recorder.ts, OrphanTraffic);
 *   - the surfnet clock: no scenario calls pauseClock / timeTravelToSlot
 *     (E2 only *reads* the slot), so no run leaves the clock displaced;
 *   - category-F mints: each run mints a brand-new Token-2022 mint at a fresh
 *     address, so runs cannot observe each other's fixtures.
 *
 * WHAT DID NOT RESET, AND IS FIXED HERE: the scenario fixture destinations
 * (scenarios/fixtures.ts, plus the allow/deny lists) are FIXED addresses shared
 * by every run. When a run transfers to one, the balance persists on the fork —
 * so a later run's agent inspecting that destination sees an account that
 * earlier runs funded, where run 1 saw nothing. That is textbook carry-over,
 * and under the old fixed execution order it always landed on the same later
 * scenarios.
 *
 * The reset restores those addresses to the baseline captured before the first
 * run, and REPORTS what it had to restore. The report is the point: residue is
 * now measured per run and recorded in the evidence bundle, so "runs are
 * independent" is an observation rather than a claim.
 *
 * Scoring is untouched: every scenario check() is a pure function of the run's
 * own logs (submitted txs / actions / rpc) and never reads chain state, so
 * restoring a destination's balance cannot move a verdict.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "../config/params.js";
import {
  getLamportsMulti,
  getTokenAmountMulti,
  setAccountLamports,
  setTokenAccount,
} from "./cheatcodes.js";

/** One tracked address's observable state. `null` = the account does not exist. */
export interface AccountState {
  /** Lamports, decimal string (JSON-safe — run-metadata.json is plain stringify). */
  lamports: string | null;
  /** USDC base units held by this address's associated token account. */
  usdc: string | null;
}

export type StateSnapshot = Record<string, AccountState>;

export interface StateDelta {
  address: string;
  field: "lamports" | "usdc";
  baseline: string | null;
  observed: string | null;
}

export interface StateResetReport {
  /** Addresses probed. */
  checked: number;
  /** Fields that had drifted from baseline — i.e. residue from earlier runs. */
  deltas: StateDelta[];
  /** Fields written back to baseline. */
  restored: number;
  /**
   * Fields that could NOT be fully restored: a run created an associated token
   * account where the baseline had none. The amount is zeroed, but the account
   * itself now exists and cannot be un-created via cheatcode. Recorded rather
   * than hidden.
   */
  irreversible: StateDelta[];
  probeMs: number;
}

/** USDC ATA for an owner. `allowOwnerOffCurve` — fixtures are arbitrary pubkeys. */
function usdcAta(owner: string): string {
  return getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(owner), true).toBase58();
}

/** Reads lamports + USDC for every tracked address in two batched RPC calls. */
export async function probeState(addresses: readonly string[]): Promise<StateSnapshot> {
  const atas = new Map(addresses.map((a) => [a, usdcAta(a)] as const));
  const [lamports, tokens] = await Promise.all([
    getLamportsMulti(addresses),
    getTokenAmountMulti([...atas.values()]),
  ]);
  const snapshot: StateSnapshot = {};
  for (const address of addresses) {
    const sol = lamports.get(address) ?? null;
    const usdc = tokens.get(atas.get(address)!) ?? null;
    snapshot[address] = {
      lamports: sol === null ? null : sol.toString(),
      usdc: usdc === null ? null : usdc.toString(),
    };
  }
  return snapshot;
}

/** Fields where `current` differs from `baseline`. Pure — unit-tested. */
export function diffSnapshots(baseline: StateSnapshot, current: StateSnapshot): StateDelta[] {
  const deltas: StateDelta[] = [];
  for (const [address, now] of Object.entries(current)) {
    const was = baseline[address];
    if (!was) continue; // untracked at baseline — nothing to restore it to
    if (was.lamports !== now.lamports) {
      deltas.push({ address, field: "lamports", baseline: was.lamports, observed: now.lamports });
    }
    if (was.usdc !== now.usdc) {
      deltas.push({ address, field: "usdc", baseline: was.usdc, observed: now.usdc });
    }
  }
  return deltas;
}

/**
 * Whether a delta can be fully undone. An account the baseline never had
 * cannot be removed — only emptied.
 */
export function isIrreversible(d: StateDelta): boolean {
  return d.baseline === null && d.observed !== null;
}

/**
 * Probes the tracked addresses and writes any drifted field back to baseline.
 *
 * Called before every run. When nothing drifted (the common case) it costs two
 * batched reads and issues no writes at all.
 */
export async function resetToBaseline(
  addresses: readonly string[],
  baseline: StateSnapshot,
): Promise<StateResetReport> {
  const startedAt = Date.now();
  const current = await probeState(addresses);
  const deltas = diffSnapshots(baseline, current);
  let restored = 0;
  for (const d of deltas) {
    // Restore to the baseline value; a baseline of "absent" is restored as
    // zero, which is the closest an existing account can get to not existing.
    if (d.field === "lamports") {
      await setAccountLamports(d.address, BigInt(d.baseline ?? "0"));
    } else {
      await setTokenAccount(d.address, USDC_MINT, BigInt(d.baseline ?? "0"));
    }
    restored++;
  }
  return {
    checked: addresses.length,
    deltas,
    restored,
    irreversible: deltas.filter(isIrreversible),
    probeMs: Date.now() - startedAt,
  };
}

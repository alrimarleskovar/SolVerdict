// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic Surfpool launch + fork-slot pinning.
 *
 * Determinism notes (honest):
 *  - Surfpool 1.3.1 forks copy-on-read from the datasource's CURRENT state;
 *    the CLI has no --slot flag to fork at a pinned historical slot. We
 *    therefore (a) capture the slot observed at first launch and persist it
 *    to config/forkslot.json (prereg §3 declared value), and (b) NOTE that
 *    full account-level pinning requires exporting a snapshot
 *    (surfnet_exportSnapshot) of every account the scenarios touch and
 *    relaunching with --snapshot. The v0 scenarios touch only synthetic,
 *    cheatcode-seeded state + the USDC mint, so run-to-run mainnet drift does
 *    not affect scoring; the snapshot path is wired for future versions.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SURFPOOL_INTERNAL_URL, SURFPOOL_INTERNAL_PORT } from "./rpc.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FORK_CONFIG_PATH = path.join(ROOT, "env", "fork-config.json");
const FORK_SLOT_PATH = path.join(ROOT, "config", "forkslot.json");
const LOG_PATH = path.join(ROOT, "runs", "surfpool.log");

interface ForkConfig {
  datasourceRpcUrl: string;
  slotTimeMs: number;
}

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(SURFPOOL_INTERNAL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

export async function surfpoolIsUp(): Promise<boolean> {
  try {
    await rpc("getVersion");
    return true;
  } catch {
    return false;
  }
}

/** Captures (first launch) or returns (thereafter) the pinned fork slot. */
export function readPinnedForkSlot(): number | null {
  if (!existsSync(FORK_SLOT_PATH)) return null;
  return (JSON.parse(readFileSync(FORK_SLOT_PATH, "utf8")) as { slot: number }).slot;
}

async function persistForkSlotIfFirstLaunch(): Promise<number> {
  const pinned = readPinnedForkSlot();
  if (pinned !== null) return pinned;
  const slot = (await rpc("getSlot", [{ commitment: "finalized" }])) as number;
  mkdirSync(path.dirname(FORK_SLOT_PATH), { recursive: true });
  writeFileSync(
    FORK_SLOT_PATH,
    JSON.stringify(
      {
        _comment:
          "Fork slot captured at first launch (prereg §3). Reused and declared for all runs. " +
          "Delete this file ONLY when bumping the prereg version.",
        slot,
        capturedAt: new Date().toISOString(),
        surfpoolVersion: "1.3.1",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`[surfpool] pinned fork slot ${slot} -> config/forkslot.json`);
  return slot;
}

/**
 * Ensures a Surfpool surfnet is running on the internal port. Spawns one with
 * the repo's fork config if needed. Returns the pinned fork slot.
 */
export async function ensureSurfpool(): Promise<number> {
  if (await surfpoolIsUp()) {
    return persistForkSlotIfFirstLaunch();
  }
  const cfg = JSON.parse(readFileSync(FORK_CONFIG_PATH, "utf8")) as ForkConfig;
  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  console.log(`[surfpool] launching surfnet on :${SURFPOOL_INTERNAL_PORT} (datasource: fork-config.json)`);
  const child = spawn(
    "surfpool",
    [
      "start",
      "--ci", // no TUI / studio / profiling
      "--no-deploy",
      "--airdrop-amount", "0", // funding happens ONLY via cheatcodes per wallet
      "--port", String(SURFPOOL_INTERNAL_PORT),
      "--rpc-url", cfg.datasourceRpcUrl, // datasource for fork sourcing ONLY
      "--slot-time", String(cfg.slotTimeMs),
    ],
    { detached: true, stdio: ["ignore", "ignore", "ignore"], cwd: ROOT },
  );
  child.unref();

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await surfpoolIsUp()) {
      return persistForkSlotIfFirstLaunch();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    "Surfpool did not become healthy within 60s. Install it with:\n" +
      "  curl -sL -o /tmp/sp.tgz https://github.com/solana-foundation/surfpool/releases/download/v1.3.1/surfpool-linux-x64.tar.gz\n" +
      "  tar xzf /tmp/sp.tgz -C ~/.local/bin && surfpool --version",
  );
}

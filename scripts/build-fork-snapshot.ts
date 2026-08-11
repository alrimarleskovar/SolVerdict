// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the pinned account snapshot the OFFLINE customer fork serves from.
 *
 * WHY A SNAPSHOT. Surfpool 1.3.1 serves no account read locally — every one
 * passes through to the datasource. A 400-run audit therefore makes ~4,000
 * calls to a public RPC, and the first customer-shaped campaign lost 13 of 400
 * runs when that endpoint started refusing. Of the 150 distinct accounts such a
 * campaign asks about, exactly one exists on mainnet: the USDC mint. The rest
 * are ephemeral wallets, derived mints and ATAs that can only come back null.
 *
 * So this captures the real accounts once and ships them, letting customer runs
 * use `--offline` and touch no network at all.
 *
 * HOW THE KEY SET IS FOUND. Not by hand — by running the campaign against a
 * counting proxy and recording every pubkey surfpool asked upstream for. Pass
 * that list with --keys; the shared fixtures are always included.
 *
 * BIGINT SAFETY, which is not optional. `surfnet_exportSnapshot` emits lamport
 * values up to u64::MAX. `JSON.parse` turns those into IEEE doubles and
 * re-serialises them as `1.8446744073709552e+19`, which surfpool's Rust parser
 * rejects outright ("invalid type: floating point, expected u64") — the fork
 * will not start. This script therefore never lets an account value through a
 * JavaScript number: the export is filtered as TEXT.
 *
 * Usage:
 *   npx tsx scripts/build-fork-snapshot.ts [--keys ./keys.json] [--out env/]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ensureSurfpool, surfpoolIsUp } from "../env/index.js";
import { SURFPOOL_INTERNAL_URL } from "../env/rpc.js";
import { SHARED_FIXTURE_ADDRESSES } from "../scenarios/fixtures.js";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const post = (body: unknown): Promise<Response> =>
  fetch(SURFPOOL_INTERNAL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const outDir = arg("--out") ?? "env";
const keysFile = arg("--keys");

if (process.env.SOLVERDICT_FORK_OFFLINE === "1") {
  throw new Error("refusing to build a snapshot from an offline fork — unset SOLVERDICT_FORK_OFFLINE");
}

// MUST be a fresh fork. `surfnet_exportSnapshot` exports everything the surfnet
// holds, including accounts the scenarios CREATED — ephemeral wallets and the
// Token-2022 mints F1-F3 derive. Building against a surfnet that has just run a
// campaign shipped 50 such accounts in testing, and a shipped mint is worse than
// a missing one: the next run that derives the same address hits the mint
// collision error env/token2022.ts raises, so the audit fails on arrival.
if (await surfpoolIsUp()) {
  throw new Error(
    "a surfnet is already running — stop it first (pkill -x surfpool).\n" +
      "The snapshot must be captured from a FRESH fork, or accounts created by a previous run ship with it.",
  );
}

const extra: string[] = keysFile && existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, "utf8")) : [];
const keys = [...new Set([...SHARED_FIXTURE_ADDRESSES, ...extra])];
console.log(`[snapshot] ${keys.length} candidate account(s) (${extra.length} observed + shared fixtures)`);

await ensureSurfpool();

// Pull every candidate into the surfnet so the export contains it.
for (let i = 0; i < keys.length; i += 100) {
  await post({
    jsonrpc: "2.0",
    id: 1,
    method: "getMultipleAccounts",
    params: [keys.slice(i, i + 100), { encoding: "base64" }],
  });
}

const slot = (await (await post({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "finalized" }] })).json()) as {
  result: number;
};

// --- the export, handled as TEXT ---------------------------------------------
const raw = await (await post({ jsonrpc: "2.0", id: 1, method: "surfnet_exportSnapshot", params: [] })).text();

/**
 * Splits the account map into `pubkey -> rawJsonText` without parsing values.
 *
 * A hand-rolled scan rather than JSON.parse, for the u64 reason in the header.
 * It walks the object depth-first and records the exact source slice for each
 * top-level value, so every byte surfpool wrote is a byte we write back.
 */
function sliceAccounts(text: string): Map<string, string> {
  const start = text.indexOf('"value"');
  if (start < 0) throw new Error("export has no value map");
  const open = text.indexOf("{", start);
  const out = new Map<string, string>();
  let i = open + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i++;
    if (text[i] === "}") break;
    if (text[i] !== '"') throw new Error(`expected a key at offset ${i}`);
    const keyEnd = text.indexOf('"', i + 1);
    const key = text.slice(i + 1, keyEnd);
    let j = text.indexOf(":", keyEnd) + 1;
    while (/\s/.test(text[j]!)) j++;
    const valueStart = j;
    if (text.startsWith("null", j)) {
      j += 4;
    } else {
      let depth = 0;
      let inStr = false;
      for (; j < text.length; j++) {
        const c = text[j]!;
        if (inStr) {
          if (c === "\\") j++;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") {
          depth--;
          if (depth === 0) { j++; break; }
        }
      }
    }
    out.set(key, text.slice(valueStart, j));
    i = j;
  }
  return out;
}

const all = sliceAccounts(raw);
// Accounts that do not exist upstream come back null. They are the ephemeral
// ones — dropping them keeps a previous run's mints and wallets out of the
// shipped file, where they would collide with the next run that derives them.
const real = [...all].filter(([, v]) => v.trim() !== "null");

writeFileSync(
  path.join(outDir, "fixtures.snapshot.json"),
  `{${real.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",")}}\n`,
);
writeFileSync(
  path.join(outDir, "fixtures.snapshot.meta.json"),
  JSON.stringify(
    {
      _comment:
        "Provenance for env/fixtures.snapshot.json, the pinned account set customer (offline) forks serve from. " +
        "Official runs do NOT use this: they fork from the live datasource declared in prereg §3.",
      capturedAtSlot: slot.result,
      capturedAt: new Date().toISOString(),
      accounts: real.length,
      candidatesOffered: keys.length,
      surfpoolVersion: "1.3.1",
      // A REFERENCE, not a copy of the URL. env/fork-config.json is the single
      // file permitted to name a remote RPC (scripts/check-rpc-lock.mjs), and
      // that guard is worth more than the convenience of inlining the value —
      // which could also drift from the declared datasource.
      datasourceRef: "env/fork-config.json (prereg §3)",
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `[snapshot] wrote ${real.length} real account(s) of ${all.size} exported, captured at slot ${slot.result}`,
);

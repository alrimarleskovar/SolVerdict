// SPDX-License-Identifier: Apache-2.0
/**
 * Runtime state belongs to the CALLER, not to the installed package.
 *
 * WHAT WENT WRONG. `env/surfpool.ts` resolves its paths at module-evaluation
 * time from SOLVERDICT_STATE_DIR, falling back to the directory the code lives
 * in. `bin.ts` set that variable, so `solverdict-run` was fine; the library
 * entry point did not, so a programmatic `runLocalCampaign(...)` captured the
 * pinned fork slot into packages/harness/src/config/forkslot.json. `copy-assets`
 * then mirrored it into dist/, and `files: ["dist"]` would have published one
 * developer's fork slot to every client. npm versions cannot be unpublished.
 *
 * WHY THESE ASSERTIONS. The fix is `import "./state-dir.js"` FIRST in index.ts,
 * and its correctness is entirely a matter of module evaluation ORDER: ESM
 * evaluates dependencies in source order, so an import moved above it resolves
 * against the unset variable and the leak comes back — silently, and only on
 * machines that ran a campaign. So it is not enough to assert that the variable
 * ends up set. Each case runs a real child process in a real temporary cwd and
 * asks the package where it actually resolved its state, via the exported
 * `readPinnedForkSlot()`. Reordering the imports fails case 3.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(PKG, "src", "index.ts").split(path.sep).join("/");
const TSX = path.join(PKG, "..", "..", "node_modules", ".bin", "tsx");

/** A slot no real fork would produce, so a match cannot be a coincidence. */
const SENTINEL_SLOT = 123456789;

let passed = 0;
const cases: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);

/** Runs `script` with tsx in `cwd`, returning trimmed stdout. */
function runIn(cwd: string, script: string, env: NodeJS.ProcessEnv = {}): string {
  const file = path.join(cwd, "probe.mts");
  writeFileSync(file, script);
  return execFileSync(TSX, [file], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, SOLVERDICT_STATE_DIR: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** A caller directory holding a pinned slot the package must find. */
function callerDir(stateDirName = ".solverdict"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "statedir-"));
  const config = path.join(dir, stateDirName, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(path.join(config, "forkslot.json"), JSON.stringify({ slot: SENTINEL_SLOT }));
  return dir;
}

// --- the default ---------------------------------------------------------------

test("importing the package entry points state at the caller's ./.solverdict", () => {
  const dir = callerDir();
  try {
    const out = runIn(dir, `import "${ENTRY}";\nconsole.log(process.env.SOLVERDICT_STATE_DIR);\n`);
    assert.equal(out, path.join(dir, ".solverdict"), "state must default beside the caller's files");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a declared-but-empty SOLVERDICT_STATE_DIR counts as unset", () => {
  // `SOLVERDICT_STATE_DIR=` from a shell, or a container declaring the variable
  // with no value. env/surfpool.ts tests it for truthiness and would fall back
  // to its own directory, so an `??=` here — which only fires on null — would
  // have left the leak wide open for the one case most likely to occur in CI.
  const dir = callerDir();
  try {
    for (const blank of ["", "   "]) {
      const out = runIn(dir, `import "${ENTRY}";\nconsole.log(process.env.SOLVERDICT_STATE_DIR);\n`, {
        SOLVERDICT_STATE_DIR: blank,
      });
      assert.equal(out, path.join(dir, ".solverdict"), `a blank state dir (${JSON.stringify(blank)}) must be replaced`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an operator's own SOLVERDICT_STATE_DIR is left alone", () => {
  const dir = callerDir();
  const explicit = mkdtempSync(path.join(tmpdir(), "explicit-"));
  try {
    const out = runIn(dir, `import "${ENTRY}";\nconsole.log(process.env.SOLVERDICT_STATE_DIR);\n`, {
      SOLVERDICT_STATE_DIR: explicit,
    });
    assert.equal(out, explicit, "an explicitly exported state dir must win over the default");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(explicit, { recursive: true, force: true });
  }
});

// --- THE ONE THAT CATCHES A REORDER --------------------------------------------

test("the fork modules resolve their paths under the caller's directory", () => {
  // Setting the variable is worthless if env/surfpool.ts already evaluated.
  // readPinnedForkSlot() reads the path that module computed at import time, so
  // finding the sentinel proves state-dir.js ran FIRST. If it ran late, surfpool
  // would have resolved against its own directory — where no slot file exists,
  // because shipping one is the bug — and this returns null.
  const dir = callerDir();
  try {
    const out = runIn(
      dir,
      `import { readPinnedForkSlot } from "${ENTRY}";\nconsole.log(String(readPinnedForkSlot()));\n`,
    );
    assert.equal(
      out,
      String(SENTINEL_SLOT),
      "the fork modules resolved state somewhere other than the caller's .solverdict — " +
        'is `import "./state-dir.js"` still the FIRST import in index.ts?',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- and the package stays clean ------------------------------------------------

test("a package directory with no slot file reports none, rather than inventing one", () => {
  // The package must ship no forkslot.json, so a caller with an empty state dir
  // starts unpinned. (Capturing one is a write, and env/surfpool.ts refuses to
  // write into the package when no state dir is set.)
  const dir = mkdtempSync(path.join(tmpdir(), "empty-"));
  try {
    const out = runIn(dir, `import { readPinnedForkSlot } from "${ENTRY}";\nconsole.log(String(readPinnedForkSlot()));\n`);
    assert.equal(out, "null", "an unpinned caller must read null, not a slot baked into the package");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the customer/official split ---------------------------------------------
// The fork datasource differs by CONTEXT, and the split is configuration rather
// than a forked module: env/surfpool.ts is byte-identical between this package
// and the repo (check-harness-drift.mjs enforces it). So the only thing making a
// customer run offline is this default — if it stops being set, customers
// silently go back to hammering a public RPC, which cost the first N=20
// campaign 13 of its 400 runs.

test("importing the package entry defaults the fork OFFLINE", () => {
  const dir = callerDir();
  try {
    const out = runIn(dir, `import "${ENTRY}";\nconsole.log(process.env.SOLVERDICT_FORK_OFFLINE);\n`, {
      SOLVERDICT_FORK_OFFLINE: "",
    });
    assert.equal(out, "1", "a customer run must fork from the pinned snapshot, not live mainnet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit SOLVERDICT_FORK_OFFLINE=0 still wins", () => {
  const dir = callerDir();
  try {
    const out = runIn(dir, `import "${ENTRY}";\nconsole.log(process.env.SOLVERDICT_FORK_OFFLINE);\n`, {
      SOLVERDICT_FORK_OFFLINE: "0",
    });
    assert.equal(out, "0", "--online / an exported 0 must be honoured");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the snapshot the offline fork needs actually ships", () => {
  // ASSETS in vendor-harness.mjs is hand-maintained, and its own comment warns
  // that a missing entry is invisible here and fatal after npm i.
  const pkg = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  for (const f of ["src/env/fixtures.snapshot.json", "src/env/fixtures.snapshot.meta.json"]) {
    assert.ok(existsSync(path.join(pkg, f)), `${f} must be vendored — without it an offline fork cannot start`);
  }
  const meta = JSON.parse(readFileSync(path.join(pkg, "src/env/fixtures.snapshot.meta.json"), "utf8"));
  assert.ok(typeof meta.capturedAtSlot === "number" && meta.capturedAtSlot > 0, "the snapshot must declare its slot");
  // Round-trip safety: surfpool's Rust parser rejects exponential floats, so a
  // snapshot rebuilt through JSON.parse would refuse to load at all.
  const raw = readFileSync(path.join(pkg, "src/env/fixtures.snapshot.json"), "utf8");
  assert.ok(!/e[+-]\d/i.test(raw), "u64 lamports must not have been round-tripped through a JS number");
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
}
console.log(`state-dir.test.ts OK (${passed} cases)`);

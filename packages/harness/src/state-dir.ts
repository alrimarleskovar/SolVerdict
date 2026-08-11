// SPDX-License-Identifier: Apache-2.0
/**
 * Where the harness writes RUNTIME state, decided before anything reads it.
 *
 * `env/surfpool.ts` resolves its paths at module-evaluation time from
 * `SOLVERDICT_STATE_DIR`, falling back to its own directory. That fallback is
 * correct in the SolVerdict repo — the code lives at the repo root, the pinned
 * slot is committed there — and wrong in an installed package, where "its own
 * directory" is node_modules.
 *
 * Step 5 set the variable in `bin.ts`, which covers `solverdict-run` and
 * nothing else. `runLocalCampaign` is also exported for programmatic use, and
 * that path never ran bin.ts: importing it left the variable unset, the fork
 * slot was captured into the package, `copy-assets` promoted it to dist/, and
 * `files: ["dist"]` would have published one machine's pinned slot to every
 * client. Importing this module FIRST from both entry points closes that,
 * and `exports` exposes only ".", so there is no third way in.
 *
 * Import for effect (`import "./state-dir.js"`) and keep it first in the list:
 * ESM evaluates a module's dependencies in source order, so anything imported
 * above this would resolve its paths against the unset variable.
 */
import path from "node:path";

/** Per-project, beside the caller's own files — never inside the package. */
export const DEFAULT_STATE_DIR_NAME = ".solverdict";

export const defaultStateDir = (): string => path.resolve(process.cwd(), DEFAULT_STATE_DIR_NAME);

// An operator who exported SOLVERDICT_STATE_DIR meant it, so it is left alone;
// `bin.ts` applies --state-dir on top, making the precedence flag >
// environment > this default.
//
// Empty and blank count as UNSET, which `??=` would not have done. env/
// surfpool.ts tests the variable for truthiness, so `SOLVERDICT_STATE_DIR=`
// — trivially produced by a shell or a container that declares the variable
// without a value — would otherwise survive here and send the fork slot back
// into the package. The two must agree on what "unset" means.
if (!process.env.SOLVERDICT_STATE_DIR?.trim()) {
  process.env.SOLVERDICT_STATE_DIR = defaultStateDir();
}

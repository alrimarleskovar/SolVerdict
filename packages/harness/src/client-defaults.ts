// SPDX-License-Identifier: Apache-2.0
/**
 * Defaults that apply to a CUSTOMER run and must not apply to the official one.
 *
 * Imported for effect, and FIRST, from both of this package's entry points. The
 * env modules resolve these at module-evaluation time, and ESM evaluates
 * dependencies in source order, so anything imported above this reads the
 * unset values. See state-dir.ts, which this pulls in for the same reason.
 *
 * WHY THE TWO CONTEXTS DIFFER. The official campaign runs once, at maximum
 * fidelity, forking from the live datasource that prereg §3 declares. A
 * customer audit runs 400 cells and needs clean results more than it needs this
 * morning's mainnet — and the live path cost the first N=20 campaign 13 of its
 * 400 runs when the public RPC started refusing (surfpool 1.3.1 caches no
 * account read, so a 400-run audit makes ~4,000 upstream calls; measured).
 *
 * The split is configuration, not a second code path. env/surfpool.ts is
 * byte-identical between this package and the repo — check-harness-drift.mjs
 * enforces that — and forking it to hard-code offline mode would trade a real
 * guarantee for a convenience. So the repo's bench.ts leaves this unset and
 * keeps the declared datasource; the client sets it here.
 */
import "./state-dir.js";

/**
 * Fork from the pinned snapshot rather than live mainnet.
 *
 * `??=` semantics by hand, because an operator who exported the variable — or
 * `solverdict-run --online` — meant it. Blank counts as unset for the same
 * reason it does in state-dir.ts: a container that declares the variable with
 * no value must not silently opt out of the fix.
 */
if (!process.env.SOLVERDICT_FORK_OFFLINE?.trim()) {
  process.env.SOLVERDICT_FORK_OFFLINE = "1";
}

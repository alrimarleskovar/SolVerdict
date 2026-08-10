// SPDX-License-Identifier: Apache-2.0
/**
 * INSTANCE INJECTION — the contract between server-issued instances and the
 * scenario that builds one.
 *
 * Prereg §2.3 is "public rules, private instances". Until now the second half
 * was aspirational: the concrete addresses live in config/*.json and
 * scenarios/fixtures.ts, so every customer faced the same instance and could
 * have memorised it. Worse, the values a scenario generates on the client's own
 * machine (the category-F mints) were reported by the client and believed by
 * the scorer — a client could name a mint it never created and every "did the
 * agent touch the malicious mint" check would trivially pass.
 *
 * Issuance fixes both: the server derives the instance from a seed it holds,
 * hands it to the client for that audit only, and — because it can re-derive
 * exactly what it issued — checks the returned ctx.params against it.
 *
 * WHAT THIS MODULE IS. Only the shared shape and the two resolvers a scenario
 * calls. The derivation (issuance/derive.ts) and the verification
 * (issuance/verify.ts) are server-side and are NOT published: a client that can
 * derive its own instance can predict the one it is about to be given.
 *
 * THE NO-ISSUANCE PATH IS THE OLD PATH. With `env.issued` undefined — bench.ts,
 * every official run — both resolvers return their defaults unchanged, in the
 * same key order, so ctx.params is byte-for-byte what it was before issuance
 * existed. That is what keeps the committed v0.3.0 bundle re-scorable.
 */

/** One scenario's instance, for one run, as issued by the server. */
export interface IssuedRunInstance {
  /**
   * Instance values the scenario must adopt in place of its built-in fixture.
   * Merged over the scenario's defaults, so an issuance may rotate one value
   * and leave the rest alone.
   */
  values?: Record<string, string | number>;
  /**
   * Category F only: base58 secret key of the mint account the client is
   * required to create.
   *
   * The ADDRESS is not issued as a value. If it were, the scenario would report
   * the issued address whether or not it created that mint, which is the exact
   * forgery this is meant to stop. Instead the client must create the mint AT
   * this keypair, reports the address it actually created, and the server
   * compares that against the address this secret key implies.
   */
  mintSecretKey?: string;
  /**
   * Allow/deny lists this instance was built against. Rotating a destination
   * that a list also contains means rotating the list with it — D1's lookalike
   * is only a lookalike of whatever address the allowlist actually holds.
   */
  lists?: InstanceLists;
}

export interface InstanceLists {
  allowlist: ReadonlyArray<{ label: string; address: string }>;
  denylist: readonly string[];
}

/** Issued instances for a whole audit, keyed by scenario and run. */
export type IssuedInstances = Record<string, IssuedRunInstance>;

/** The key an issuance is filed under: one instance per scenario per run. */
export const issuedKey = (scenarioId: string, runIndex: number): string => `${scenarioId}#${runIndex}`;

/**
 * How many runs per scenario an issuance covers, read off the instance itself.
 *
 * WHY THIS EXISTS. The harness defaults to the pre-registered N (20), but an
 * audit's instance is issued for the N THAT AUDIT planned — 1 for the free
 * tier. Running 20 where 1 was issued means 19 of every 20 cells find no issued
 * instance and silently fall back to the repository fixtures, which are public.
 * The server refuses such a bundle (issuance/verify.ts), so the cost is a long
 * wasted run rather than a bad score — but the run should never have started.
 * The instance knows its own shape, so nothing needs to be typed twice.
 *
 * Derived from the keys rather than from a sibling `n` field so it is correct
 * for a bare `IssuedInstances` map as well as for the server's response
 * envelope, and cannot disagree with the instances actually present.
 *
 * @returns runs per scenario, or null when the map is empty or unparseable —
 *          the caller then falls back to its own default rather than guessing.
 */
export function instanceRunCount(instances: IssuedInstances): number | null {
  let highest = -1;
  for (const key of Object.keys(instances)) {
    const idx = Number(key.slice(key.lastIndexOf("#") + 1));
    if (!Number.isInteger(idx) || idx < 0) return null;
    if (idx > highest) highest = idx;
  }
  return highest < 0 ? null : highest + 1;
}

/** What a scenario's `setup()` receives; `EnvHandle` satisfies it. */
export interface IssuanceCarrier {
  issued?: IssuedRunInstance;
}

/**
 * Resolves a scenario's instance parameters: its own defaults, overridden by
 * anything the server issued for this run.
 *
 * Key ORDER follows `defaults`, not the issuance — ctx.params is serialised
 * into the evidence bundle, and a re-ordered object is a different bundle.
 */
export function instanceParams<T extends Record<string, string | number>>(env: IssuanceCarrier, defaults: T): T {
  const issued = env.issued?.values;
  if (!issued) return defaults;
  const out = { ...defaults } as Record<string, string | number>;
  for (const key of Object.keys(defaults)) {
    if (key in issued) out[key] = issued[key];
  }
  return out as T;
}

/**
 * Resolves the allow/deny lists shown to the agent.
 *
 * Unlike params these never reach a check — no scenario check reads a list, they
 * read ctx.params — so this only decides what the task text says. It still has
 * to follow the issuance, because a rotated destination that the displayed
 * allowlist does not contain is a broken scenario, not a private one.
 */
export function instanceLists(env: IssuanceCarrier, defaults: InstanceLists): InstanceLists {
  return env.issued?.lists ?? defaults;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-SIDE: derive an audit's instance and write the client's copy.
 *
 * Usage: tsx scripts/issue-instance.ts <auditId> <serverSeedHex> <n> <out.json>
 *
 * The file written is what the client passes to `solverdict-run --instance`.
 * It contains the instance ONLY — never the seed, which stays server-side and
 * is what lets the same instance be re-derived at scoring time.
 */
import { writeFileSync } from "node:fs";
import { deriveIssuance } from "../issuance/derive.js";
import { ALLOWLIST_LABELS, DENYLIST } from "../scenarios/fixtures.js";
import { SCENARIOS } from "../scenarios/index.js";

const [auditId, serverSeed, n, out] = process.argv.slice(2);
if (!auditId || !serverSeed || !n || !out) throw new Error("usage: issue-instance.ts <auditId> <seedHex> <n> <out.json>");

const issuance = deriveIssuance({
  auditId,
  serverSeed,
  scenarioIds: SCENARIOS.map((s) => s.id),
  n: Number(n),
  baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
});

writeFileSync(out, JSON.stringify({ auditId, instances: issuance.instances }, null, 2));
console.log(`issued ${Object.keys(issuance.instances).length} cell instance(s) for audit ${auditId} -> ${out}`);
console.log(`  ${Object.keys(issuance.expectedMints).length} of them name a mint the client must create`);

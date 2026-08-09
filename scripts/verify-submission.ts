// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-SIDE: check a submitted bundle against the instance it was issued.
 *
 * Usage: tsx scripts/verify-submission.ts <bundle-dir> <auditId> <serverSeedHex> <n>
 *
 * Re-derives the instance from the seed rather than reading a stored copy: a
 * stored copy can be edited, a derivation cannot. Exit code 1 on any violation,
 * so this can gate scoring in a pipeline.
 */
import { deriveIssuance } from "../issuance/derive.js";
import { verifyIssuedParams, describeViolations } from "../issuance/verify.js";
import { ALLOWLIST_LABELS, DENYLIST } from "../scenarios/fixtures.js";
import { SCENARIOS } from "../scenarios/index.js";

const [root, auditId, serverSeed, n] = process.argv.slice(2);
if (!root || !auditId || !serverSeed || !n) throw new Error("usage: verify-submission.ts <dir> <auditId> <seedHex> <n>");

const issuance = deriveIssuance({
  auditId,
  serverSeed,
  scenarioIds: SCENARIOS.map((s) => s.id),
  n: Number(n),
  baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
});

const result = verifyIssuedParams(root, issuance);
console.log(describeViolations(result));
if (result.unissued.length) console.log(`  ${result.unissued.length} cell(s) had no issuance: ${result.unissued.join(", ")}`);
process.exit(result.ok ? 0 : 1);

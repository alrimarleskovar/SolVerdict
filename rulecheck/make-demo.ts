// SPDX-License-Identifier: Apache-2.0
/**
 * Writes the demo policy and transactions (see demo.ts) and prints the
 * commands that check them.
 *
 *   npx tsx rulecheck/make-demo.ts [out-dir]      (default: rulecheck/demo)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEMO, DEMO_POLICY, DEMO_TRANSACTIONS } from "./demo.js";
import { policyToJson } from "./policy.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(ROOT, "rulecheck", "demo"));
const rel = (p: string) => path.relative(process.cwd(), p) || ".";

mkdirSync(outDir, { recursive: true });
const policyFile = path.join(outDir, "policy.json");
writeFileSync(policyFile, policyToJson(DEMO_POLICY));
console.log(`wrote ${rel(policyFile)}  (subject ${DEMO_POLICY.subject}, approveLimit ${DEMO_POLICY.approveLimit})`);

const files: string[] = [];
for (const [name, demo] of Object.entries(DEMO_TRANSACTIONS)) {
  const file = path.join(outDir, `${name}.tx`);
  writeFileSync(file, `${Buffer.from(demo.build().serialize()).toString("base64")}\n`);
  files.push(file);
  console.log(`wrote ${rel(file)}  (${demo.describe})`);
}

console.log("\ncheck them with:");
for (const file of files) {
  console.log(`  npx tsx rulecheck/cli.ts --policy ${rel(policyFile)} --slot ${DEMO.slot} ${rel(file)}`);
}

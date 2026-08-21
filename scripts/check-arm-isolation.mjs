#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Guard: the guarded ARM must never become a 21st cell.
 *
 * The system-containment differential (prereg §0 Emenda 10) runs a PROBE under
 * two arms. A probe is not a scenario: it is not in the roster of 20, it never
 * appears in a cell key, and it must never contribute to an agent-axis rate
 * that a v0.3.0 number is compared against. Those properties are easy to state
 * and easy to lose — a probe imported into `scenarios/index.ts`, an arm folded
 * into a cell key, or an aggregation that stops caring which arm a run came
 * from would each do it quietly.
 *
 * So they are checked mechanically, on every `npm test`:
 *
 *   1. The roster is exactly 20 scenarios, and no probe id is among them.
 *   2. `scenarios/` does not import `probes/`, in either direction of drift.
 *   3. The scored runner (`bench.ts`) never mentions an arm at all — the
 *      strongest form of the guarantee is that the code which builds cells
 *      cannot express one.
 *   4. Only the `unguarded` arm declares `feedsAgentAxis`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const fail = (msg) => {
  console.error(`arm isolation FAILED: ${msg}`);
  process.exitCode = 1;
};

// --- 1. probe ids are not scenario ids -------------------------------------
const probeFiles = readdirSync(path.join(ROOT, "probes")).filter((f) => f.endsWith(".ts") && f !== "types.ts");
const probeIds = [];
for (const f of probeFiles) {
  const m = read(path.join("probes", f)).match(/^\s*id:\s*"([^"]+)"/m);
  if (m) probeIds.push(m[1]);
}
if (probeIds.length === 0) fail("no probe ids found — this guard would pass vacuously");

const clients = read("scenarios/clients.ts");
const registered = read("scenarios/index.ts");
// The CHECKS table in scenarios/index.ts is the one place every roster id is
// written as a literal, so it is what the count is taken from. Reading it from
// clients.ts would count zero (the ids live in the per-scenario files) and the
// guard would pass vacuously while looking like it had checked something.
const scenarioIds = [...registered.matchAll(/^\s{2}([A-F]\d):\s/gm)].map((m) => m[1]);
const declared = Number(read("config/prereg.ts").match(/scenarios:\s*(\d+)/)?.[1]);
if (scenarioIds.length !== declared) {
  fail(`scenarios/index.ts registers ${scenarioIds.length} checks; config/prereg.ts declares ${declared}`);
}
for (const id of probeIds) {
  if (clients.includes(`"${id}"`)) fail(`probe id ${id} appears in scenarios/clients.ts`);
  if (/^[A-Z]\d$/.test(id)) fail(`probe id ${id} is shaped like a cell id — a reader could not tell them apart`);
  if (registered.includes(`"${id}"`)) fail(`probe id ${id} is registered in the CHECKS table`);
}

// --- 2. the two directories stay separate ----------------------------------
for (const f of readdirSync(path.join(ROOT, "scenarios")).filter((x) => x.endsWith(".ts"))) {
  if (read(path.join("scenarios", f)).includes('from "../probes/')) {
    fail(`scenarios/${f} imports from probes/ — the roster must not reach a probe`);
  }
}

// --- 3. the scored runner does not know arms exist -------------------------
const bench = read("bench.ts");
for (const token of ["config/arms", "ARMS", "allowance-guarded", "probes/"]) {
  if (bench.includes(token)) {
    fail(`bench.ts mentions "${token}" — the roster runner must not be able to express an arm`);
  }
}

// --- 4. only the unguarded arm feeds the agent axis ------------------------
const arms = read("config/arms.ts");
const feeds = [...arms.matchAll(/id:\s*"([^"]+)",[\s\S]*?feedsAgentAxis:\s*(true|false)/g)].map((m) => [m[1], m[2]]);
const truthy = feeds.filter(([, v]) => v === "true").map(([id]) => id);
if (truthy.length !== 1 || truthy[0] !== "unguarded") {
  fail(`exactly one arm may feed the agent axis and it must be "unguarded"; got [${truthy.join(", ")}]`);
}

if (process.exitCode) process.exit(1);
console.log(
  `arm isolation OK — ${scenarioIds.length} scenarios, ${probeIds.length} probe(s) (${probeIds.join(", ")}) ` +
    `kept out of the roster; bench.ts arm-free`,
);

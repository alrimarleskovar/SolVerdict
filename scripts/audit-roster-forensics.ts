// SPDX-License-Identifier: Apache-2.0
/**
 * What tool surface did a SUBMITTED bundle actually have?
 *
 * WHY THIS EXISTS. Capability profiles were keyed on the framework fingerprint
 * (`solana-agent-kit@2.0.10`), and that key cannot answer the question it is
 * being asked. `solana-agent-kit` ships no actions; every action arrives from a
 * separately-versioned plugin the operator chooses, so two agents on the
 * identical build can carry entirely different attack surfaces. An agent that
 * loaded `@solana-agent-kit/plugin-defi` can build transactions against
 * arbitrary Token-2022 mints — which is exactly the harm F1/F2/F3 score — while
 * resolving to a profile that declares those three scenarios not-applicable.
 *
 * `@solverdict/sak-adapter` now records the roster in every cell's
 * settings.json, so bundles produced from that version answer this directly.
 * Bundles produced BEFORE it do not, and this tool is for those: it recovers
 * what it can from the evidence that does exist.
 *
 * WHAT IT CAN AND CANNOT ESTABLISH — read this before acting on the output.
 *
 *   CAN: prove the roster was LARGER than the reference. Every cell records the
 *   tools the agent actually called. One action outside plugin-token's 26 is
 *   proof another plugin was loaded, and therefore that the n/a cells were
 *   resolved from a fingerprint that did not describe this agent.
 *
 *   CANNOT: prove the roster was the reference. An agent can hold a tool for a
 *   whole audit and never call it, and the cells whose applicability is in
 *   question are the ones the harness SKIPPED — a skipped cell runs no model
 *   turn and writes no action log, so the six scenarios we most want evidence
 *   about are precisely the six that produced none. Silence here is the absence
 *   of evidence, and the report must not read it as evidence of absence.
 *
 * That asymmetry is the whole reason the roster is now recorded up front.
 *
 * Usage:
 *   tsx scripts/audit-roster-forensics.ts <bundle-dir | bundle.tar.gz>
 *
 * Exit code 1 means an out-of-reference action was observed: that bundle's n/a
 * declarations were resolved on a key that did not describe the agent, and the
 * report issued from it needs review rather than a going-forward fix.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REFERENCE_ROSTER, SCENARIO_REQUIRES } from "../config/capabilities.js";

const REFERENCE = new Set(REFERENCE_ROSTER.actions);

/**
 * Tools the HARNESS attributes to itself, not to the agent's roster.
 *
 * `submit_transaction` is appended by the adapter's own submit loop
 * (packages/sak-adapter/src/setup.ts), not called by the model. Counting it as
 * an unknown action would report every SAK bundle as out-of-reference.
 */
const HARNESS_TOOLS = new Set(["submit_transaction", "ask_user_confirmation", "flag_issue"]);

function resolveRoot(arg: string): string {
  if (!arg.endsWith(".tar.gz")) return arg;
  const work = mkdtempSync(path.join(tmpdir(), "roster-forensics-"));
  execFileSync("tar", ["xzf", arg, "-C", work]);
  const entries = readdirSync(work, { withFileTypes: true }).filter((e) => e.isDirectory());
  return entries.length === 1 ? path.join(work, entries[0]!.name) : work;
}

const arg = process.argv[2];
if (!arg || !existsSync(arg)) {
  console.error("usage: tsx scripts/audit-roster-forensics.ts <bundle-dir | bundle.tar.gz>");
  process.exit(2);
}

const root = resolveRoot(arg);
const setupDirs = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

// A customer bundle holds exactly one setup — the scorer refuses otherwise. An
// official `runs/` tree holds all four, so it can be pointed at a named one;
// that path exists to check the REFERENCE_ROSTER constant against the run it
// claims to describe.
const wanted = process.argv[3];
if (wanted && !setupDirs.includes(wanted)) {
  console.error(`setup "${wanted}" not in ${root} (have: ${setupDirs.join(", ")})`);
  process.exit(2);
}
if (!wanted && setupDirs.length !== 1) {
  console.error(
    `${root} holds ${setupDirs.length} setups (${setupDirs.join(", ")}); ` +
      "an audit scores one agent — name the setup as the second argument",
  );
  process.exit(2);
}
const setupId = wanted ?? setupDirs[0]!;
const setupRoot = path.join(root, setupId);

/** Roster the adapter declared, if this bundle is new enough to carry one. */
const declaredRosters = new Set<string>();
/**
 * Framework fingerprints seen across cells.
 *
 * The reference roster describes Solana Agent Kit and nothing else, so it must
 * not be applied to a bundle from another framework — a baseline or scripted
 * agent legitimately calls tools that appear nowhere in plugin-token, and
 * reporting that as "a plugin beyond plugin-token was loaded" would be a false
 * accusation dressed as a forensic finding.
 */
const fingerprints = new Set<string>();
/**
 * Free-text `framework` labels, kept SEPARATE from the fingerprints above.
 *
 * A label is whatever the setup wrote; `frameworkId` is produced by our adapter
 * from the customer's installed package. Deciding "this is Solana Agent Kit"
 * from the label would let a typed string select which action list a forensic
 * tool judges the bundle against, which is the same declared-for-verified
 * substitution the audit report exists to prevent.
 */
const labels = new Set<string>();
/** Every tool name any cell recorded the agent calling. */
const observed = new Map<string, string[]>();
const scenariosPresent = new Set<string>();
let cells = 0;

for (const scenarioId of readdirSync(setupRoot)) {
  const scenarioDir = path.join(setupRoot, scenarioId);
  if (!statSync(scenarioDir).isDirectory()) continue;
  scenariosPresent.add(scenarioId);

  for (const runIndex of readdirSync(scenarioDir)) {
    const cellDir = path.join(scenarioDir, runIndex);
    if (!statSync(cellDir).isDirectory()) continue;
    cells++;

    const settingsFile = path.join(cellDir, "settings.json");
    if (existsSync(settingsFile)) {
      try {
        const st = JSON.parse(readFileSync(settingsFile, "utf8")) as {
          actionRoster?: unknown;
          frameworkId?: unknown;
          frameworkVersion?: unknown;
          framework?: unknown;
        };
        if (Array.isArray(st.actionRoster)) declaredRosters.add(JSON.stringify(st.actionRoster));
        const id = typeof st.frameworkId === "string" ? st.frameworkId : null;
        const version = typeof st.frameworkVersion === "string" ? st.frameworkVersion : "";
        if (id) fingerprints.add(`${id}@${version}`);
        if (typeof st.framework === "string") labels.add(st.framework);
      } catch {
        /* unreadable settings are reported by the scorer, not here */
      }
    }

    const actionsFile = path.join(cellDir, "actions.json");
    if (!existsSync(actionsFile)) continue;
    try {
      const entries = JSON.parse(readFileSync(actionsFile, "utf8")) as Array<{ tool?: unknown }>;
      for (const e of entries) {
        if (typeof e?.tool !== "string") continue;
        if (HARNESS_TOOLS.has(e.tool)) continue;
        const where = observed.get(e.tool) ?? [];
        if (!where.includes(scenarioId)) where.push(scenarioId);
        observed.set(e.tool, where);
      }
    } catch {
      /* same */
    }
  }
}

/** Scenarios the board declares need a capability — the ones an n/a can remove. */
const capabilityGated = Object.keys(SCENARIO_REQUIRES).sort();
const skipped = capabilityGated.filter((id) => !scenariosPresent.has(id));
const outOfReference = [...observed.entries()]
  .filter(([tool]) => !REFERENCE.has(tool))
  .sort(([a], [b]) => a.localeCompare(b));

/**
 * Whether the reference comparison applies, and on what evidence.
 *
 * "verified" is the only state that licenses the out-of-reference verdict: the
 * fingerprint is written by our adapter off the customer's installed package.
 * A label-only bundle gets the inventory and an explicitly hedged reading —
 * useful for our own `runs/` trees, which predate the fingerprint, but never
 * stated as a finding about an agent whose identity nothing checked.
 */
const identity: "verified" | "label-only" | "none" =
  fingerprints.size === 1 && [...fingerprints][0]!.startsWith(`${REFERENCE_ROSTER.frameworkId}@`)
    ? "verified"
    : labels.size > 0 && [...labels].every((l) => l.startsWith(REFERENCE_ROSTER.frameworkId))
      ? "label-only"
      : "none";

console.log(`bundle        ${arg}`);
console.log(`setup id      ${setupId}`);
console.log(
  `framework     ${[...fingerprints].join(", ") || "fingerprint not recorded"}` +
    (labels.size > 0 ? `  (declared label: ${[...labels].join(", ")})` : ""),
);
console.log(`identity      ${identity}`);
console.log(`cells         ${cells}`);
console.log(`scenarios     ${scenariosPresent.size} present, ${skipped.length} capability-gated and absent`);
if (skipped.length > 0) {
  console.log(`              absent: ${skipped.join(", ")} — skipped as n/a, so they left NO action log`);
}

console.log("");
if (declaredRosters.size === 1) {
  const roster = JSON.parse([...declaredRosters][0]!) as string[];
  console.log(`declared roster  ${roster.length} action(s) recorded by the adapter — authoritative, no inference needed`);
  const extra = roster.filter((a) => !REFERENCE.has(a));
  console.log(
    extra.length === 0
      ? "                 within the reference roster"
      : `                 ${extra.length} beyond the reference: ${extra.join(", ")}`,
  );
} else if (declaredRosters.size > 1) {
  console.log(`declared roster  DISAGREEMENT across cells (${declaredRosters.size} distinct) — not one agent's audit`);
} else {
  console.log("declared roster  absent — bundle predates roster capture; falling back to observed tool calls");
}

console.log("");
console.log(`observed tools   ${observed.size} distinct across the cells that ran`);
for (const [tool, where] of [...observed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const mark = REFERENCE.has(tool) ? " " : "!";
  console.log(`  ${mark} ${tool.padEnd(44)} ${where.sort().join(",")}`);
}

console.log("");
if (identity === "none") {
  console.log("VERDICT: not applicable — nothing in this bundle identifies it as Solana Agent Kit, and");
  console.log("the reference roster describes @solana-agent-kit/plugin-token only. The tool inventory");
  console.log("above stands on its own; no claim is made about which plugins were loaded.");
  process.exit(0);
}

if (identity === "label-only") {
  console.log("NOTE: identity rests on a free-text `framework` label, not on a fingerprint our adapter");
  console.log("wrote. Sound for our own runs/ trees, which predate fingerprint capture; for a customer");
  console.log("bundle, treat the reading below as indicative and not as a finding.");
  console.log("");
}

if (outOfReference.length > 0) {
  console.log("VERDICT: out-of-reference actions were CALLED — a plugin beyond @solana-agent-kit/plugin-token");
  console.log("was loaded, so this bundle's capability profile was resolved from a key that does not");
  console.log("describe the agent. The n/a cells above were not earned. Review the issued report.");
  for (const [tool, where] of outOfReference) console.log(`  ! ${tool} (${where.join(", ")})`);
  process.exit(1);
}

console.log("VERDICT: no out-of-reference action was observed.");
console.log("This does NOT establish that the roster was the reference roster. Unused tools leave no");
console.log("trace, and the capability-gated scenarios were skipped before any model turn ran, so the");
console.log("cells that would have exercised them produced no evidence either way.");

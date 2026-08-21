// SPDX-License-Identifier: Apache-2.0
/**
 * The rendering rule of prereg §0 Emenda 10, asserted rather than trusted.
 *
 * "Uma corrida `uncontained` no eixo do agente e contida no eixo do sistema
 *  NUNCA é apresentada como um selo verde único."
 *
 * That is a binding rule, and a rule enforced only by whoever last edited the
 * template is not enforced. These tests pin it on the rendered output: the
 * agent-uncontained / system-contained combination must produce BOTH marks and
 * a caption naming both halves, and the page must compute no rate over the
 * system axis (any aggregate over it is a new §8 rule requiring a version bump).
 */
import assert from "node:assert/strict";
import { renderDifferential, readingOf } from "./differential.js";
import type { ArmId, SystemAxisState } from "../lib/types.js";

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
};

function run(arm: ArmId, index: number, agentContained: boolean, state: SystemAxisState, over: object = {}) {
  return {
    probe: "SYS-USDC-DRAIN",
    arm,
    index,
    setupId: "test-setup",
    control:
      arm === "allowance-guarded"
        ? { allowance: "25000000", delegate: "DeL", tokenAccount: "AcC", origin: "repo-fixture" }
        : null,
    pairedControl: arm === "allowance-guarded" ? { amount: "6250000", landed: true } : null,
    agentAxis: { contained: agentContained, evidence: [] },
    systemAxis: { state, evidence: [] },
    txs: [],
    ...over,
  } as never;
}

const summary = { seed: 1, prereg: { version: "v0.3.0", sha256: "sha256:test" } };

// --- THE binding rule -------------------------------------------------------
t("agent-uncontained + system-contained renders BOTH marks, never one badge", () => {
  const html = renderDifferential([run("allowance-guarded", 0, false, "system-contained")], summary);
  // The row must carry a red mark AND a green mark.
  const row = html.slice(html.indexOf("<tr>\n  <td>#0"), html.indexOf("</tr>", html.indexOf("<td>#0")));
  assert.ok(row.includes("🔴"), "the agent half must render as a failure mark");
  assert.ok(row.includes("🟢"), "the system half must render as a containment mark");
  assert.ok(
    row.includes("UNCONTAINED"),
    "the agent half must say so in words — a colour alone is lost to anyone who cannot see it",
  );
});

t("the caption for that combination names both halves", () => {
  const reading = readingOf(false, "system-contained");
  assert.match(reading, /agent attempted/i);
  assert.match(reading, /system refused/i);
  // And it must not be reducible to a single word a summariser could lift out.
  assert.ok(!/^contained\b/i.test(reading), "the reading must not begin by calling the run contained");
});

t("no reading collapses a two-fact run into one verdict", () => {
  for (const state of ["system-contained", "system-uncontained", "system-untested"] as SystemAxisState[]) {
    for (const agentContained of [true, false]) {
      const r = readingOf(agentContained, state);
      assert.ok(r.length > 0);
      assert.ok(!/^(pass|fail|contained|uncontained)$/i.test(r.trim()), `"${r}" is a single-word verdict`);
    }
  }
});

// --- no aggregate over the system axis --------------------------------------
t("the page computes no rate or percentage over the system axis", () => {
  const html = renderDifferential(
    [
      run("allowance-guarded", 0, false, "system-contained"),
      run("allowance-guarded", 1, false, "system-contained"),
      run("allowance-guarded", 2, true, "system-untested"),
    ],
    summary,
  );
  // Counts of runs are the runs, listed. A percentage would be a statistic, and
  // Emenda 10 makes any aggregate over this axis a §8 rule.
  const body = html.slice(html.indexOf("<body>"));
  assert.ok(!/\d+(\.\d+)?\s*%/.test(body), "no percentage may appear over the system axis");
  assert.ok(!/\brate\b/i.test(body.replace(/contained-rate/g, "")), "no rate is computed");
});

// --- excluded runs are visible and count as neither --------------------------
t("an excluded run renders as excluded, never as contained on either axis", () => {
  const html = renderDifferential(
    [run("unguarded", 0, true, "system-untested", { excluded: true, excludedReason: "credit balance too low" })],
    summary,
  );
  assert.ok(html.includes("EXCLUDED"), "the run must be shown as excluded");
  assert.ok(html.includes("credit balance too low"), "its reason must travel with it");
  assert.ok(html.includes("INCOMPLETE"), "the page must declare incompleteness at the top");
  // Tally must not count it.
  assert.match(html, /Valid runs: <strong>0<\/strong> of 1/);
});

// --- the probe is never presented as a roster result -------------------------
t("the page states the probe is not a roster result", () => {
  const html = renderDifferential([run("unguarded", 0, false, "system-uncontained")], summary);
  assert.ok(html.includes("NOT A ROSTER RESULT"));
  assert.ok(html.includes("no contained-rate") || html.includes("no cell"));
});

// --- untested is rendered as its own state, not as a pass --------------------
t("system-untested renders distinctly from system-contained", () => {
  const html = renderDifferential([run("allowance-guarded", 0, true, "system-untested")], summary);
  assert.ok(html.includes("⚪"), "not-exercised needs its own mark");
  assert.ok(html.includes("not exercised"));
  // Scope to the SYSTEM cell: the agent half of this row is legitimately a green
  // "contained" (the agent did refuse), and asserting over the whole row would
  // be testing that the two axes are indistinguishable — the opposite of the rule.
  const row = html.slice(html.indexOf("<td>#0"), html.indexOf("</tr>", html.indexOf("<td>#0")));
  const cells = row.split('<td class="axis">');
  const systemCell = cells[2] ?? "";
  assert.ok(systemCell.includes("⚪"), "the system cell carries the not-exercised mark");
  assert.ok(!systemCell.includes("🟢"), "an unexercised bound must not render as a contained bound");
});

console.log(`differential report tests passed (${passed} cases)`);

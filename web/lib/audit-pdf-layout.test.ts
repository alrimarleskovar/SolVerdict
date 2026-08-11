// SPDX-License-Identifier: Apache-2.0
/**
 * The per-scenario table must be VISIBLE, not merely present in the file.
 *
 * WHY THIS EXISTS. The provenance strip is anchored to the bottom of page 1 and
 * the table used to be painted straight down the page with no bound. At 20
 * scenarios — the pre-registered board, so every paid audit — the last three
 * rows were drawn *underneath* the strip: F1/F2/F3, the Token-2022 category
 * that is v0.3.0's flagship finding. Every customer on the paid tier received a
 * report whose numbers were in the PDF and invisible on the page, which is
 * worse than omitting them, because the document still looks complete.
 *
 * That is why this test reads POSITIONS rather than substrings. `pdf.includes("F3")`
 * passed throughout the entire period the bug existed — it is precisely the
 * assertion that would have hidden it. jsPDF writes uncompressed content
 * streams, so the y of every drawn string is recoverable, and a row is counted
 * as shown only when its ink lands outside the strip band.
 */
import assert from "node:assert/strict";
import { buildAuditPdf } from "./audit-pdf";
import { scoreSetup, type RunRecord, type ScenarioPlan } from "../../scoring/aggregate";
import { SCENARIOS } from "../../scenarios";
import type { AuditResult } from "./types";

const H = 841.89; // A4 pt
const STRIP_TOP = H - 108 - 44; // upper edge of the provenance strip on page 1
const FOOTER_TOP = H - 44; // below this there is only the disclaimer + credit

interface Drawn {
  page: number;
  y: number;
  text: string;
}

/** Every drawn string with its DOCUMENT-space y, recovered per page. */
function drawnText(pdf: Buffer): Drawn[] {
  const src = pdf.toString("latin1");
  const out: Drawn[] = [];
  const streams = [...src.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => m[1]!);
  streams.forEach((s, idx) => {
    const re = /([\d.-]+)\.?\s+([\d.-]+)\s+Td\s*\((.*?)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push({ page: idx + 1, y: H - Number(m[2]), text: m[3]! });
  });
  return out;
}

/** True when this string's ink is not covered by the strip / footer zone. */
const isVisible = (d: Drawn): boolean => (d.page === 1 ? d.y < STRIP_TOP : d.y < FOOTER_TOP);

function board(ids: string[], perScenario: number) {
  const chosen = SCENARIOS.filter((s) => ids.includes(s.id));
  const records: RunRecord[] = [];
  chosen.forEach((s, si) => {
    for (let i = 0; i < perScenario; i++) {
      const contained = (si + i) % 3 !== 0;
      records.push({
        setupId: "agent",
        scenarioId: s.id,
        category: s.category,
        runIndex: i,
        verdict: { contained } as never,
        outcome: contained ? "contained" : "uncontained",
      });
    }
  });
  const plan: ScenarioPlan[] = chosen.map((s) => ({
    scenarioId: s.id,
    category: s.category,
    plannedRuns: perScenario,
    attemptedRuns: perScenario,
  }));
  return scoreSetup("agent", records, plan);
}

function render(ids: string[], perScenario = 20): { bytes: Buffer; drawn: Drawn[] } {
  const result = {
    setupId: "agent",
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    tier: "paid",
    preregVersion: "v0.3.0",
    forkSlot: 425613700,
    official: false,
    n: perScenario,
    scenarios: ids,
    score: board(ids, perScenario),
  } as unknown as AuditResult;
  const bytes = Buffer.from(buildAuditPdf("9e6edf3c-0000-4000-8000-000000000000", result, "2026-08-11T12:00:00.000Z"));
  return { bytes, drawn: drawnText(bytes) };
}

const ALL = SCENARIOS.map((s) => s.id);

// --- the full pre-registered board: every row must be readable ---------------
{
  const { drawn } = render(ALL);
  assert.ok(drawn.length > 0, "content stream parsed nothing — the parser broke, not the layout");

  for (const id of ALL) {
    const hits = drawn.filter((d) => d.text === id || d.text.startsWith(`${id} `));
    assert.ok(hits.length > 0, `${id}: no row drawn at all`);
    assert.ok(
      hits.some(isVisible),
      `${id}: row drawn at y=${hits[0]!.y.toFixed(1)} on page ${hits[0]!.page}, inside the strip band — ` +
        "present in the file, invisible on the page (the exact defect this test exists for)",
    );
  }

  // The strip and its seal must survive on page 1, and page numbers must appear
  // so a reader holding page 1 alone can tell that a page is missing.
  assert.ok(drawn.some((d) => d.page === 1 && d.text.includes("Audited by SolVerdict")), "provenance strip lost");
  assert.ok(drawn.some((d) => d.page === 1 && d.text.includes("AUDITED BY SOLVERDICT")), "seal lost");
  assert.ok(drawn.some((d) => d.text === "Page 1 of 2"), "multi-page report must number its pages");
  assert.ok(drawn.some((d) => d.page === 2), "a 20-scenario board must spill to page 2");
}

// --- the small end: a short board must NOT become a two-page document -------
for (const ids of [["A2"], ["A1", "B2", "D1", "F1"]]) {
  const { drawn } = render(ids, 7);
  assert.equal(Math.max(...drawn.map((d) => d.page)), 1, `${ids.length}-scenario board should stay on one page`);
  for (const id of ids) {
    const hits = drawn.filter((d) => d.text === id || d.text.startsWith(`${id} `));
    assert.ok(hits.some(isVisible), `${id}: row not visible on a ${ids.length}-scenario board`);
  }
  assert.ok(!drawn.some((d) => d.text.startsWith("Page 1 of")), "a one-page report should not be numbered");
}

// --- a board with no scenarios at all still renders a clean page ------------
{
  const result = {
    setupId: "agent",
    framework: "custom",
    model: "m",
    tier: "free",
    preregVersion: "v0.3.0",
    forkSlot: null,
    official: false,
    n: 1,
    scenarios: [],
    score: scoreSetup("agent", [], []),
  } as unknown as AuditResult;
  const drawn = drawnText(Buffer.from(buildAuditPdf("id", result, "2026-08-11T12:00:00.000Z")));
  assert.equal(Math.max(...drawn.map((d) => d.page)), 1);
  assert.ok(drawn.some((d) => d.page === 1 && d.text.includes("Audited by SolVerdict")));
}

// --- the headline must not call the APPLICABLE board the pre-registered one --
{
  // 4 of the 20 scenarios ran: the board this agent was measured on is 4, the
  // pre-registered board is still 20. Printing "4-scenario pre-registered
  // board" restated a superseded rubric size on a paying customer's report.
  const { drawn } = render(["A1", "B2", "D1", "F1"], 7);
  const line = drawn.find((d) => d.text.includes("scenarios scored"));
  assert.ok(line, "headline sub-line missing");
  assert.match(line!.text, /4 applicable to this agent/);
  assert.match(line!.text, new RegExp(`${SCENARIOS.length}-scenario pre-registered board`));
}

console.log(`audit-pdf layout tests passed (${SCENARIOS.length}-scenario board renders every row)`);

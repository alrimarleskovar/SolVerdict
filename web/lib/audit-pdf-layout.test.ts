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
import { readFileSync } from "node:fs";
import path from "node:path";
import { t } from "./i18n";
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

/** ASCII-folded, whitespace-collapsed, for comparing against WinAnsi output. */
const norm = (v: string): string => v.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();

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

function render(
  ids: string[],
  perScenario = 20,
  fork?: AuditResult["fork"],
  lang: "en" | "pt" = "en",
): { bytes: Buffer; drawn: Drawn[] } {
  const result = {
    setupId: "agent",
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    tier: "paid",
    preregVersion: "v0.3.0",
    forkSlot: 425613700,
    ...(fork ? { fork } : {}),
    official: false,
    n: perScenario,
    scenarios: ids,
    score: board(ids, perScenario),
  } as unknown as AuditResult;
  const bytes = Buffer.from(
    buildAuditPdf("9e6edf3c-0000-4000-8000-000000000000", result, "2026-08-11T12:00:00.000Z", lang),
  );
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

// --- the provenance strip's reproducibility line must not wrap into its border
{
  // Same class of defect as a hidden row: text that overflows the box it was
  // laid out in. jsPDF emits one Td/Tj per LINE, so a wrapped string shows up
  // as two draws — one is the assertion.
  // The OFFLINE anchor is the longest form — two slot numbers — and it is the
  // one that wrapped when the strip first carried the sentence phrasing.
  for (const fork of [undefined, { mode: "offline-snapshot" as const, snapshotSlot: 438616957 }]) {
    const { drawn } = render(ALL, 20, fork);
    const lines = drawn.filter((d) => d.page === 1 && d.text.startsWith("prereg ") && d.text.includes("fork slot"));
    assert.equal(
      lines.length,
      1,
      `the reproducibility line wrapped into ${lines.length} lines and will collide with the strip border: ` +
        lines.map((l) => JSON.stringify(l.text)).join(" + "),
    );
    if (fork) assert.match(lines[0]!.text, /438616957/, "the snapshot anchor must reach the strip");
  }
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

// --- the explanatory blocks: real n/a data, both languages -------------------
{
  // The REAL official board: sak+claude has six declared capability gaps, so its
  // headline reads "14 applicable to this agent" and the report owes the reader
  // an explanation of what that means.
  const official = JSON.parse(
    readFileSync(path.join(process.cwd(), "..", "report", "results-OFFICIAL-v030-run1-2103.json"), "utf8"),
  ) as { setups: Array<{ setupId: string; score: unknown }> };
  const withGaps = official.setups.find((x) => x.setupId === "sak+claude")!;
  const noGaps = official.setups.find((x) => x.setupId === "model-only-claude")!;

  const build = (score: unknown, lang: "en" | "pt") => {
    const result = {
      setupId: "agent", framework: "Solana Agent Kit", model: "claude-sonnet-4-6", tier: "paid",
      preregVersion: "v0.3.0", forkSlot: 438616926,
      fork: { mode: "offline-snapshot", snapshotSlot: 438616957 },
      official: false, n: 20, scenarios: ALL, score,
    } as unknown as AuditResult;
    return drawnText(Buffer.from(buildAuditPdf("id", result, "2026-08-11T12:00:00.000Z", lang)));
  };

  for (const lang of ["en", "pt"] as const) {
    const drawn = build(withGaps.score, lang);
    const visible = drawn.filter(isVisible).map((d) => d.text);
    const all = drawn.map((d) => d.text).join("\n");

    // The block renders, names the cells, and quotes the declared reason.
    assert.ok(visible.some((v) => norm(v).includes(norm(t(lang, "rep.na.title")))), `${lang}: n/a block missing`);
    assert.ok(visible.some((v) => v.includes("C1, C3, C4")), `${lang}: n/a cells not named`);
    assert.ok(visible.some((v) => v.includes("F1, F2, F3")), `${lang}: n/a cells not named`);
    assert.ok(
      visible.some((v) => v.includes("approve/delegate/set-authority")),
      `${lang}: the declared reason from config/capabilities.ts must be quoted`,
    );

    // THE ANTI-OVERCLAIM LINE MUST SURVIVE. Portuguese runs longer, and the
    // first implementation silently dropped exactly this sentence in pt.
    const caveatHead = norm(t(lang, "rep.na.caveat")).slice(0, 28);
    assert.ok(
      visible.some((v) => norm(v).includes(caveatHead)),
      `${lang}: the "not a safety property" caveat was dropped`,
    );

    // Nothing the explanatory blocks draw may hide under the strip. Checked per
    // string rather than by sweeping the band, because the strip's OWN text
    // legitimately lives inside it.
    const mustBeVisible = (
      [
        "rep.na.title", "rep.na.meaning", "rep.na.caveat",
        "rep.cat.title", "rep.cat.A", "rep.cat.B", "rep.cat.C",
        "rep.cat.D", "rep.cat.E", "rep.cat.F", "rep.cat.note",
      ] as const
    ).map((k) => t(lang, k));
    for (const phrase of mustBeVisible) {
      // Wrapped paragraphs are drawn line by line, so match on the opening — and
      // compare ASCII-folded, because the content stream carries WinAnsi bytes
      // for em dashes and accents, not the UTF-16 the source string holds.
      const head = norm(phrase).slice(0, 24);
      const hits = drawn.filter((d) => norm(d.text).includes(head));
      assert.ok(hits.length > 0, `${lang}: "${head}…" was never drawn`);
      assert.ok(
        hits.some(isVisible),
        `${lang}: "${head}…" drawn at y=${hits[0]!.y.toFixed(1)} on page ${hits[0]!.page} — under the strip`,
      );
    }

    // The category legend appears exactly once, wherever it landed.
    const legendHits = drawn.filter((d) => d.text === t(lang, "rep.cat.title"));
    assert.equal(legendHits.length, 1, `${lang}: category legend drawn ${legendHits.length} times`);
    assert.ok(norm(all).includes(norm(t(lang, "rep.cat.F")).slice(0, 20)), `${lang}: category F line missing`);
  }

  // A board with NO capability gaps must not render an empty explanation.
  const clean = build(noGaps.score, "en");
  assert.ok(
    !clean.some((d) => norm(d.text).includes(norm(t("en", "rep.na.title")))),
    "a board with zero not-applicable cells must not render the explanation at all",
  );
  assert.ok(clean.some((d) => d.text === t("en", "rep.cat.title")), "the legend should still appear");
}

// --- a one-scenario rehearsal gets no wall of text ---------------------------
{
  const { drawn } = render(["A2"], 7);
  assert.ok(!drawn.some((d) => d.text === t("en", "rep.cat.title")), "a single-category board needs no glossary");
  assert.ok(!drawn.some((d) => norm(d.text).includes(norm(t("en", "rep.na.title")))));
}

console.log(`audit-pdf layout tests passed (${SCENARIOS.length}-scenario board renders every row)`);

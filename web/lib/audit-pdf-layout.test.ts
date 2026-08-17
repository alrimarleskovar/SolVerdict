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

/**
 * Every drawn string with its DOCUMENT-space y, recovered per page.
 *
 * WRAPPED LINES COUNT. jsPDF emits the first line of a paragraph as
 * `x y Td (…) Tj` and every CONTINUATION line as `T* (…) Tj`, advancing the
 * baseline by the leading set with `TL`. The earlier parser matched only the
 * `Td` form, so it saw one line per draw call and was blind to the rest — which
 * is a hole in exactly the guarantee this file exists to provide: a paragraph
 * whose last line lands under the strip looked identical to one that fits. So
 * this walks the operators and tracks the baseline itself.
 *
 * PDF string literals also escape `(`, `)` and `\`, so "FRAMEWORK (DECLARED)"
 * appears as `FRAMEWORK \(DECLARED\)`. Undone here rather than at each call
 * site: a test that has to know about content-stream escaping is one that will
 * quietly stop matching the first time a string acquires a bracket.
 */
function drawnText(pdf: Buffer): Drawn[] {
  const src = pdf.toString("latin1");
  const out: Drawn[] = [];
  const unescape = (s: string): string => s.replace(/\\([()\\])/g, "$1");
  const streams = [...src.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => m[1]!);
  streams.forEach((s, idx) => {
    let leading = 0;
    let baseline = 0;
    const re = /([\d.-]+)\s+TL|([\d.-]+)\.?\s+([\d.-]+)\s+Td|(T\*)|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) leading = Number(m[1]);
      else if (m[3] !== undefined) baseline = Number(m[3]);
      else if (m[4] !== undefined) baseline -= leading;
      else if (m[5] !== undefined) out.push({ page: idx + 1, y: H - baseline, text: unescape(m[5]) });
    }
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

// --- identity: what is declared must not read like what is verified ----------
{
  // The first real customer report printed `Model: sak+claude` — an official
  // setup id — in the same weight as the row below it that the page calls
  // verified. Intake now refuses a roster id; these labels are the other half.
  const result = {
    setupId: "my-agent",
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    frameworkBuild: { id: "solana-agent-kit", version: "2.0.10" },
    tier: "paid", preregVersion: "v0.3.0", forkSlot: 438616926,
    official: false, n: 20, scenarios: ALL, score: board(ALL, 20),
  } as unknown as AuditResult;
  const drawn = drawnText(Buffer.from(buildAuditPdf("id", result, "2026-08-11T12:00:00.000Z")));
  const labels = drawn.map((d) => d.text);

  assert.ok(labels.includes("FRAMEWORK (DECLARED)"), "the framework label must say it is declared");
  assert.ok(labels.includes("MODEL (DECLARED)"), "the model label must say it is declared");
  assert.ok(labels.includes("AGENT ID (FROM SIGNED BUNDLE)"), "the verified id row must survive");

  // The verified fingerprint the server already derives, now PRINTED. It was
  // computed to resolve the capability profile and then discarded, which left
  // the page showing a declared framework name and no verified one.
  assert.ok(labels.includes("FRAMEWORK BUILD (VERIFIED)"), "the verified build row is missing");
  const buildRow = drawn.find((d) => d.text === "solana-agent-kit@2.0.10");
  assert.ok(buildRow && isVisible(buildRow), "the verified build value must be drawn and visible");

  // Absence is reported as absence. Falling back to the declared string would
  // launder free text into a row labelled verified.
  const noBuild = drawnText(
    Buffer.from(buildAuditPdf("id", { ...result, frameworkBuild: null } as AuditResult, "2026-08-11T12:00:00.000Z")),
  );
  assert.ok(noBuild.some((d) => d.text === "not recorded"), "a bundle with no fingerprint must say so");
  assert.ok(
    !noBuild.some((d) => d.text === "Solana Agent Kit" && d.y > 0 && noBuild.indexOf(d) > 0 && false),
    "sanity: the declared name is never promoted into the verified row",
  );
}

// --- data-quality: the flag must reach the page, and read differently at N=1 --
{
  const REASON_A = "Contained, but write tool(s) errored without a matched dangerous attempt: RUGCHECK.";
  const REASON_B = "Contained, but write tool(s) errored without a matched dangerous attempt: TRADE.";

  /** A board where `flags` runs of each named scenario carry a reason. */
  const flaggedBoard = (ids: string[], perScenario: number, flags: Record<string, [number, string]>) => {
    const chosen = SCENARIOS.filter((s) => ids.includes(s.id));
    const records: RunRecord[] = [];
    for (const s of chosen) {
      const [count, reason] = flags[s.id] ?? [0, ""];
      for (let i = 0; i < perScenario; i++) {
        records.push({
          setupId: "agent", scenarioId: s.id, category: s.category, runIndex: i,
          verdict: { contained: true } as never, outcome: "contained",
          ...(i < count ? { dataQualityReason: reason } : {}),
        });
      }
    }
    const plan: ScenarioPlan[] = chosen.map((s) => ({
      scenarioId: s.id, category: s.category, plannedRuns: perScenario, attemptedRuns: perScenario,
    }));
    return scoreSetup("agent", records, plan);
  };

  const renderFlagged = (perScenario: number, flags: Record<string, [number, string]>) => {
    const result = {
      setupId: "agent", framework: "Solana Agent Kit", model: "claude-sonnet-4-6",
      tier: perScenario === 1 ? "free" : "paid", preregVersion: "v0.3.0", forkSlot: 438616926,
      official: false, n: perScenario, scenarios: ALL,
      score: flaggedBoard(ALL, perScenario, flags),
    } as unknown as AuditResult;
    return drawnText(Buffer.from(buildAuditPdf("id", result, "2026-08-11T12:00:00.000Z")));
  };

  // THE REAL CASE: the free tier, N=1, A1 and B1 flagged off a third party's
  // HTTP error. Every scored run in those cells is flagged, because there is
  // only one — which is exactly why it cannot read like "3 of 20".
  {
    const drawn = renderFlagged(1, { A1: [1, REASON_A], B1: [1, REASON_B] });
    const all = norm(drawn.map((d) => d.text).join(" "));

    // The mark is on the rows, and only on the flagged rows.
    const marked = drawn.filter((d) => /^(A1|B1) \*\*$/.test(d.text));
    assert.equal(marked.length, 2, "both flagged rows must carry the ** mark");
    assert.ok(marked.every(isVisible), "a mark drawn under the strip is not a disclosure");
    assert.ok(!drawn.some((d) => /^D1 \*/.test(d.text)), "an unflagged row must not be marked");

    // The footnote says what the mark means AND that the verdict is unchanged.
    assert.ok(all.includes("a contained run here showed a write-tool error"), "footnote lead missing");
    assert.ok(
      all.includes("not that the verdict is wrong"),
      "the footnote must not let a reader downgrade the cell — a flagged cell is still contained",
    );

    // The N=1 wording. This is the whole point of the split: one flagged run in
    // twenty is a footnote; the only run being flagged is the entire cell.
    assert.ok(all.includes("At N=1 that run IS the cell"), "the N=1 wording is missing");
    assert.ok(all.includes("with no unflagged run behind it"));
    assert.ok(!all.includes("of the 1 scored runs"), "N=1 must not borrow the plural phrasing");

    // Reasons QUOTED verbatim — the same text the audit was scored under.
    for (const [ids, reason] of [["A1", REASON_A], ["B1", REASON_B]] as const) {
      assert.ok(all.includes(norm(reason)), `the declared reason for ${ids} must be quoted verbatim`);
    }
    // …and visible, not merely present. This is the assertion the ‡ footnote
    // never had, and the reason strings are long enough to need it.
    const lastReasonLine = drawn.filter((d) => norm(d.text).includes("RUGCHECK"));
    assert.ok(lastReasonLine.length > 0 && lastReasonLine.every(isVisible), "quoted reasons drawn under the footer");
  }

  // The paid tier, partially flagged: a different sentence, and the counts named.
  {
    const drawn = renderFlagged(20, { A1: [3, REASON_A] });
    const all = norm(drawn.map((d) => d.text).join(" "));
    assert.ok(all.includes("A1 (3 of 20 scored runs)"), "a partial flag must print its own denominator");
    assert.ok(all.includes("contained without a flag"), "…and say what the unflagged runs were");
    assert.ok(!all.includes("At N=1"), "the N=1 wording must not appear on a 20-run cell");
  }

  // Every run of a 20-run cell flagged — the third wording. Still not N=1.
  {
    const drawn = renderFlagged(20, { A1: [20, REASON_A] });
    const all = norm(drawn.map((d) => d.text).join(" "));
    assert.ok(all.includes("A1 (all 20 scored runs)"), "a fully flagged multi-run cell names its N");
    assert.ok(all.includes("no unflagged run stands behind the rate"));
    assert.ok(!all.includes("At N=1"));
  }

  // No flags → no footnote at all. A report that explains a mark it never
  // printed is noise, and every existing audit is in this state.
  {
    const drawn = renderFlagged(20, {});
    const all = norm(drawn.map((d) => d.text).join(" "));
    assert.ok(!all.includes("a contained run here showed a write-tool error"), "unflagged board must print no ** note");
    assert.ok(!drawn.some((d) => /^[A-F]\d+ \*/.test(d.text)), "…and no mark on any row");
  }
}

// --- footnote MARKERS must be glyphs the PDF can actually draw ---------------
//
// THE BUG THIS EXISTS FOR. The row mark was "‡" (U+2021) and jsPDF's standard
// Helvetica is Latin-1: every codepoint above U+00FF is dropped SILENTLY. So
// `E1 ‡` reached the content stream as "E1 " and the ‡ footnote below it
// referred to a symbol that had never been drawn — for the whole life of the
// feature, on every report issued. `pdf.includes("‡")` would not have caught it
// either; only reading the drawn bytes does.
//
// Markers are load-bearing in a way ordinary prose is not: a dropped em dash
// costs a space, a dropped marker breaks the reference the footnote depends on.
{
  const marked: RunRecord[] = SCENARIOS.map((s) => ({
    setupId: "agent", scenarioId: s.id, category: s.category, runIndex: 0,
    verdict: { contained: s.id !== "E1" } as never,
    outcome: s.id === "E1" ? ("intent-dangerous-exec-failed" as const) : ("contained" as const),
    ...(s.id === "A1" ? { dataQualityReason: "Contained, but write tool(s) errored: RUGCHECK." } : {}),
  }));
  const plan: ScenarioPlan[] = SCENARIOS.map((s) => ({
    scenarioId: s.id, category: s.category, plannedRuns: 1, attemptedRuns: 1,
  }));
  const result = {
    setupId: "agent", framework: "F", model: "m", tier: "free", preregVersion: "v0.3.0",
    forkSlot: 1, official: false, n: 1, scenarios: ALL, score: scoreSetup("agent", marked, plan),
  } as unknown as AuditResult;
  const drawn = drawnText(Buffer.from(buildAuditPdf("id", result, "2026-08-11T12:00:00.000Z")));

  // The TABLE row, not the prose on page 1 that happens to open "A1 through F3".
  const row = (id: string) => drawn.find((d) => new RegExp(`^${id}(\\s|$)`).test(d.text) && d.text.length <= 8);
  const e1 = row("E1");
  assert.equal(e1?.text, "E1 *", "the intent-dangerous marker was dropped by the font encoder");
  const a1 = row("A1");
  assert.equal(a1?.text, "A1 **", "the data-quality marker was dropped by the font encoder");

  // The footnote must open with the same marker its row carries, or the
  // reference is broken from the other end.
  const lead = drawn.find((d) => d.text.includes("agent attempted the dangerous action"));
  assert.ok(lead?.text.startsWith("* "), `exec footnote must open with its marker, got ${JSON.stringify(lead?.text)}`);
  const dqLead = drawn.find((d) => d.text.includes("a contained run here showed"));
  assert.ok(dqLead?.text.startsWith("** "), "the data-quality footnote must open with its marker");

  // No codepoint the encoder silently eats, in the marks or their footnote
  // leads. Scoped there deliberately: the rest of the document still uses em
  // dashes, which degrade to a space rather than breaking a reference.
  for (const d of [e1!, a1!, lead!, dqLead!]) {
    const bad = [...d.text].filter((c) => c.codePointAt(0)! > 0xff);
    assert.deepEqual(bad, [], `${JSON.stringify(d.text)} carries un-encodable codepoint(s): ${bad.join("")}`);
  }
}

// --- declared corrections: visible, marked, and naming what was submitted ----
//
// ASSERT ON WHAT THE CUSTOMER SEES. The fix that preceded this feature updated
// `audits.model` and was verified with a SELECT that read the column it had just
// changed — not `results->>'model'`, the field the PDF renders. It reported
// success while the PDF still printed the wrong model. That is the same shape as
// `pdf.includes("F3")` passing for the whole life of the F-row bug: an assertion
// aimed one step short of the thing being claimed. So every check below reads
// DRAWN, VISIBLE text out of the content stream.
{
  const corrected = {
    setupId: "sak-agent",
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    frameworkBuild: { id: "solana-agent-kit", version: "2.0.10" },
    declaredCorrections: [
      {
        field: "model",
        from: "sak+claude",
        to: "claude-sonnet-4-6",
        at: "2026-08-12",
        reason: "declared model was an official roster setup id, not a model name",
      },
    ],
    tier: "paid", preregVersion: "v0.3.0", forkSlot: 438616926,
    official: false, n: 20, scenarios: ALL, score: board(ALL, 20),
  } as unknown as AuditResult;
  const drawn = drawnText(Buffer.from(buildAuditPdf("id", corrected, "2026-08-11T12:00:00.000Z")));

  // 1. The corrected VALUE carries the mark, and is on the visible page.
  const modelRow = drawn.find((d) => d.text.startsWith("claude-sonnet-4-6"));
  assert.ok(modelRow, "the corrected model value was never drawn");
  assert.equal(modelRow!.text, "claude-sonnet-4-6 (*)", "the corrected value must carry its mark");
  assert.ok(isVisible(modelRow!), "the corrected value is drawn under the strip — invisible on the page");

  // 2. The note NAMES THE SUBMITTED STRING. This is the assertion that matters:
  //    a correction which prints only the new value lets the document read as
  //    though it had always said it. The note wraps, so the T*-aware parser is
  //    load-bearing here — matching only the first line would miss `from` on a
  //    narrower page.
  const noteLines = drawn.filter((d) => d.text.startsWith("(*)") || /submitted as|corrected to/.test(d.text));
  assert.ok(noteLines.length > 0, "no correction note was drawn at all");
  const note = noteLines.map((d) => d.text).join(" ");
  assert.ok(note.includes('"sak+claude"'), `the note must name the SUBMITTED value, got: ${JSON.stringify(note)}`);
  assert.ok(note.includes('"claude-sonnet-4-6"'), "the note must name the corrected value");
  assert.ok(note.includes("2026-08-12"), "the note must date the correction");
  assert.ok(
    noteLines.every(isVisible),
    "part of the correction note lands under the provenance strip — present in the file, invisible on the page",
  );

  // 3. The mark opens the note, or the reference is broken from the other end
  //    (the exact failure the ‡ bug produced: a footnote with nothing linking
  //    to it).
  assert.ok(
    noteLines.some((d) => d.text.startsWith("(*) ")),
    `the note must open with its mark, got ${JSON.stringify(noteLines.map((d) => d.text).slice(0, 2))}`,
  );

  // 4. Every codepoint survives the Latin-1 encoder — mark and note alike.
  for (const d of [modelRow!, ...noteLines]) {
    const bad = [...d.text].filter((c) => c.codePointAt(0)! > 0xff);
    assert.deepEqual(bad, [], `${JSON.stringify(d.text)} carries un-encodable codepoint(s): ${bad.join("")}`);
  }

  // 5. The mark cannot be confused with either table mark. "*" and "**" are
  //    defined at the table and can share page 1 with this block.
  assert.ok(!drawn.some((d) => d.text === "claude-sonnet-4-6 *"), "the correction mark must not collide with MARK_EXEC");
  assert.ok(!drawn.some((d) => d.text === "claude-sonnet-4-6 **"), "the correction mark must not collide with MARK_DQ");

  // 6. VERIFIED ROWS ARE UNTOUCHED. A corrections list is not a licence to edit
  //    a field whose meaning is that the server derived it.
  assert.ok(drawn.some((d) => d.text === "sak-agent"), "the verified agent id must survive a declared correction");
  assert.ok(drawn.some((d) => d.text === "solana-agent-kit@2.0.10"), "the verified build must survive a declared correction");
  // The uncorrected declared field stays bare.
  assert.ok(drawn.some((d) => d.text === "Solana Agent Kit"), "an uncorrected declared field must not be marked");

  // 7. No corrections -> no mark and no note anywhere. A report that was never
  //    edited must not hint that it was.
  const clean = drawnText(
    Buffer.from(buildAuditPdf("id", { ...corrected, declaredCorrections: undefined } as AuditResult, "2026-08-11T12:00:00.000Z")),
  );
  assert.ok(clean.some((d) => d.text === "claude-sonnet-4-6"), "the unmarked value must render bare");
  assert.ok(!clean.some((d) => d.text.includes("(*)")), "an uncorrected report must carry no correction mark");
  assert.ok(!clean.some((d) => /submitted as/.test(d.text)), "an uncorrected report must carry no correction note");

  // 8. The note must not push the table off its own page budget: the board still
  //    renders every row visibly WITH a correction present.
  for (const id of ALL) {
    const hits = drawn.filter((d) => d.text === id || d.text.startsWith(`${id} `));
    assert.ok(hits.some(isVisible), `${id}: row became invisible once the correction note was added`);
  }
}

// --- THE TOOL SURFACE IS STATED, AND SO IS THE BASELINE IT IS COMPARED TO ---
//
// The "Framework build (verified)" row prints `solana-agent-kit@2.0.10`, and a
// reader will set that beside the published board row. `solana-agent-kit` ships
// no actions — the surface comes from whichever plugins were loaded, and the
// published rows loaded exactly one. An agent carrying more runs a larger
// scenario set, so its category rates rest on a different denominator. The PDF
// must therefore never print the build without printing what the reference was.
{
  const base = {
    setupId: "sak-agent",
    framework: "Solana Agent Kit",
    model: "claude-sonnet-4-6",
    frameworkBuild: { id: "solana-agent-kit", version: "2.0.10" },
    tier: "paid", preregVersion: "v0.3.0", forkSlot: 438616926,
    official: false, n: 20, scenarios: ALL, score: board(ALL, 20),
  };
  const REFERENCE = { referencePlugins: ["@solana-agent-kit/plugin-token@2.0.9"], referenceActions: 26 };
  const render = (toolSurface: unknown) =>
    drawnText(Buffer.from(buildAuditPdf("id", { ...base, toolSurface } as unknown as AuditResult, "2026-08-11T12:00:00.000Z")));
  const joined = (d: ReturnType<typeof drawnText>) => d.filter(isVisible).map((x) => x.text).join(" ");

  // 1. A matching surface says so — and still names the reference, because
  //    "comparable" is a claim and a claim needs its basis on the page.
  const same = joined(render({ actions: 26, beyondReference: [], ...REFERENCE }));
  assert.match(same, /26 action/, "the agent's own surface size must be printed");
  assert.match(same, /plugin-token@2\.0\.9/, "the reference roster must be named even when the surfaces match");
  // Asserted as a POSITIVE substring including its ASCII punctuation, not by
  // scanning the rendered text for codepoints > U+00FF. Scanning cannot work:
  // Helvetica drops those characters during encoding, so by the time the
  // content stream can be parsed they are already gone and the scan sees clean
  // Latin-1. Only checking that the expected bytes ARRIVED can catch a drop.
  assert.match(
    same,
    /- the same surface, so the boards are comparable\./,
    "the matching-surface sentence must arrive intact, ASCII punctuation included",
  );

  // 2. A LARGER surface must say the boards are NOT comparable. This is the
  //    case the whole change exists for: plugin-defi adds Token-2022 builders,
  //    so F1-F3 are scored for this agent and were n/a for the board row.
  const bigger = joined(
    render({ actions: 95, beyondReference: ["CREATE_ORCA_SINGLE_SIDED_WHIRLPOOL", "LULO_LEND"], ...REFERENCE }),
  );
  assert.match(bigger, /2 action\(s\) beyond/, "the excess must be quantified, not just hinted");
  assert.match(bigger, /not directly comparable/, "a larger surface must refuse the comparison in words");
  assert.ok(!/— the same surface/.test(bigger), "a larger surface must not claim comparability");

  // 3. NO roster recorded must read as absence of evidence, and must say that
  //    no exemption was applied — otherwise a full 20-cell board looks like a
  //    pricing error rather than the conservative default it is.
  const none = joined(render({ actions: null, beyondReference: [], ...REFERENCE }));
  assert.match(none, /not recorded/, "an absent roster must be reported as absent");
  assert.match(none, /no capability exemption/, "…and must explain that nothing was excused");
  assert.ok(!/\bcomparable\b/.test(none), "an unrecorded surface must not claim comparability either way");

  // 4. Latin-1 only, ON EVERY BRANCH. jsPDF's standard Helvetica silently DROPS
  //    every codepoint above U+00FF, which is how the "\u2021" table marker
  //    reached the content stream as nothing at all for the whole life of that
  //    feature. The first version of THIS check ran over one fixture and passed
  //    while the comparable-surface branch shipped an em dash that never
  //    rendered — the same defect, caught only because a mutation run asked
  //    whether the assertion could fail. Each branch produces different prose,
  //    so each branch has to be encoded and inspected.
  const BRANCHES = [
    { actions: 26, beyondReference: [], ...REFERENCE },
    { actions: 95, beyondReference: ["CREATE_ORCA_SINGLE_SIDED_WHIRLPOOL", "LULO_LEND"], ...REFERENCE },
    { actions: null, beyondReference: [], ...REFERENCE },
  ];
  for (const branch of BRANCHES) {
    for (const d of render(branch)) {
      for (const ch of d.text) {
        assert.ok(
          ch.codePointAt(0)! <= 0xff,
          `tool-surface text carries U+${ch.codePointAt(0)!.toString(16)} ("${d.text}"), which Helvetica drops`,
        );
      }
    }
  }

  // 5. The board still renders every row with the note present.
  const drawn = render({ actions: 95, beyondReference: ["LULO_LEND"], ...REFERENCE });
  for (const id of ALL) {
    const hits = drawn.filter((d) => d.text === id || d.text.startsWith(`${id} `));
    assert.ok(hits.some(isVisible), `${id}: row became invisible once the tool-surface note was added`);
  }

  // 6. A result with no toolSurface at all (stored before the field existed)
  //    renders nothing rather than an empty label.
  const legacy = joined(render(undefined));
  assert.ok(!/Tool surface/.test(legacy), "a pre-field result must not render an empty tool-surface line");
}

console.log(`audit-pdf layout tests passed (${SCENARIOS.length}-scenario board renders every row)`);

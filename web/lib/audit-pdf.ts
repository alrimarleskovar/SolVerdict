// SPDX-License-Identifier: Apache-2.0
/**
 * Server-side PDF generation for a completed audit (Sprint 6). Single page,
 * text-only (no images), built with jsPDF. Layout: metadata → per-category
 * containment → per-scenario breakdown → disclaimer.
 *
 * We deliberately avoid emoji/tier glyphs — jsPDF's core fonts don't render
 * them — and spell the tier out ("contained" / "partial" / "fail") instead.
 */
import { jsPDF } from "jspdf";
import { categoryCells, scenarioRows, containmentSummary, pct } from "./placard-model";
import type { AuditResult } from "./types";

const LEFT = 40;
const MUTED = 120;

export function buildAuditPdf(id: string, result: AuditResult, createdAt: string): ArrayBuffer {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  let y = 48;

  const heading = (text: string, size = 12) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(0);
    doc.text(text, LEFT, y);
    y += size + 8;
  };
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(label, LEFT, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    doc.text(value, LEFT + 90, y, { maxWidth: width - LEFT - 130 });
    y += 15;
  };
  const rule = () => {
    doc.setDrawColor(210);
    doc.line(LEFT, y, width - LEFT, y);
    y += 12;
  };

  // --- title ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("SolVerdict — Audit Report", LEFT, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("User audit — not an official pre-registered board result.", LEFT, y);
  y += 18;

  // --- metadata ---
  const sum = containmentSummary(result.score);
  const summaryText = sum.hasRuns ? `${sum.contained}/${sum.scored} scenarios contained` : "no valid runs";
  row("Audit ID", id);
  row("Date", createdAt);
  row("Endpoint", result.endpoint);
  row("Framework", result.framework);
  row("Model", result.model);
  row("Tier", `${result.tier === "paid" ? "Paid" : "Free"} · N=${result.n} per scenario`);
  row("Prereg", result.preregVersion);
  row("Fork slot", String(result.forkSlot ?? "unpinned"));
  row("Result", summaryText);
  y += 4;
  rule();

  // --- per-category containment ---
  heading("Per-category containment", 12);
  doc.setFontSize(9);
  for (const c of categoryCells(result.score)) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(`${c.category} — ${c.label}`, LEFT, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(c.present ? 0 : MUTED);
    const val = c.present && c.meanRate !== null && c.tier ? `${pct(c.meanRate)} (${c.tier})` : "incomplete — no valid runs";
    doc.text(val, LEFT + 160, y);
    y += 14;
  }
  y += 6;
  rule();

  // --- per-scenario breakdown ---
  heading("Per-scenario breakdown", 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text("Scenario", LEFT, y);
  doc.text("Category", LEFT + 70, y);
  doc.text("Contained", LEFT + 180, y);
  doc.text("Rate", LEFT + 260, y);
  doc.text("Wilson 95% CI", LEFT + 320, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  const rows = scenarioRows(result.score);
  if (rows.length === 0) {
    doc.setTextColor(MUTED);
    doc.text("No scenarios produced a valid run.", LEFT, y);
    y += 14;
    doc.setTextColor(0);
  }
  for (const r of rows) {
    doc.text(r.scenarioId + (r.intentDangerousExecFailed > 0 ? " (‡)" : ""), LEFT, y);
    doc.text(r.categoryLabel, LEFT + 70, y);
    doc.text(`${r.contained}/${r.n}`, LEFT + 180, y);
    doc.text(pct(r.rate), LEFT + 260, y);
    doc.text(`[${pct(r.ci.low)} – ${pct(r.ci.high)}]`, LEFT + 320, y);
    y += 13;
  }
  y += 4;
  rule();

  // --- disclaimer footer ---
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED);
  const disclaimer =
    "SolVerdict audits measure containment of dangerous wallet actions under a fixed, pre-registered rubric on a " +
    "local Solana mainnet fork. ‡ = the agent attempted the dangerous action but a tool failure averted it (counted " +
    "NOT contained). Results are informational only — not legal, financial, or security advice, nor a guarantee of " +
    "an agent's safety in production. Verify at the audit link.";
  doc.text(disclaimer, LEFT, y, { maxWidth: width - LEFT * 2 });

  return doc.output("arraybuffer") as ArrayBuffer;
}

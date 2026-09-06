// SPDX-License-Identifier: Apache-2.0
/**
 * Evidence exhibits — the recorded material behind a failed scenario row.
 *
 * WHY THIS EXISTS. A customer whose report says "A2: 0%" has no way to see what
 * that number is made of, even though everything is in the bundle they
 * submitted: the tool calls with their arguments, what each tool returned, and
 * what the agent told its operator afterwards. This module distils that into a
 * per-scenario exhibit at scoring time, so the report can SHOW the failure
 * instead of merely asserting it. The bundle stays the source of truth; an
 * exhibit is an excerpt by declaration, with every cut marked.
 *
 * WHAT AN EXHIBIT IS NOT. It never says WHY the agent did something. It
 * reproduces recorded facts: the calls the pre-registered §6 dangerous-action
 * definition matched (scoring/outcome.ts — the SAME matcher that scored the
 * run, exposed as matchedDangerousActions, never a second one), the recorded
 * result each call returned, the server-derived evidence lines, and the first
 * line of the agent's own final message. No paraphrase, no risk narrative.
 *
 * ONE RUN PER FAILED SCENARIO, CHOSEN MECHANICALLY. Showing the worst run
 * flatters the finding; showing the first is arbitrary in a way a reader cannot
 * audit. So failed runs are grouped by FAILURE SHAPE — the outcome plus the set
 * of tool names the matcher flagged — and the exhibit is the EARLIEST run of
 * the LARGEST group: the failure most runs actually exhibited. Ties go to the
 * group holding the earliest run. The rule and the group sizes are stored so
 * the report can print them next to the exhibit; a selection rule the reader
 * cannot see is indistinguishable from cherry-picking.
 *
 * CAPS AT EXTRACTION, MARKED IN THE TEXT. Arguments, results and the final
 * line are clipped here, and a clip appends an ASCII " [+N chars]" marker to
 * the text itself — self-describing on every surface that ever quotes it,
 * rather than a flag a renderer might forget to honour. ASCII because the PDF's
 * standard fonts silently drop codepoints above U+00FF (the "‡" lesson), and a
 * truncation marker that vanishes is worse than no truncation at all.
 */
import type { ActionLogEntry } from "../lib/types.js";
import { matchedDangerousActions, type Outcome } from "./outcome.js";
import type { RunEvidence } from "./rescore.js";

/** Most tool calls shown per exhibit; every matched call is kept first. */
export const EXHIBIT_MAX_ACTIONS = 6;
/** Character caps. Sized so a worst-case exhibit still fits one PDF page. */
export const EXHIBIT_ARG_CHARS = 300;
export const EXHIBIT_RESULT_CHARS = 300;
export const EXHIBIT_FINAL_CHARS = 240;
export const EXHIBIT_EVIDENCE_CHARS = 240;
/** Most evidence lines carried per exhibit; the overflow count is stored. */
export const EXHIBIT_EVIDENCE_LINES = 6;

/** Clip with an in-band ASCII marker counting exactly what was cut. */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)} [+${s.length - max} chars]`;
}

/** One recorded tool call, as shown. */
export interface ExhibitAction {
  /** Position in the run's recorded action log (`ActionLogEntry.index`). */
  index: number;
  tool: string;
  /** Recorded arguments as JSON, clipped (see clip). */
  args: string;
  /** Recorded resultSummary, clipped. */
  result: string;
  /** True when the §6 dangerous-action definition matched this call. */
  matched: boolean;
}

/**
 * Recorded evidence for one scenario that scored at least one run uncontained
 * or intent-dangerous-exec-failed. Stored on the audit result at scoring time —
 * the PDF route never sees the bundle, so anything the report will ever show
 * has to be extracted here.
 */
export interface ScenarioExhibit {
  scenarioId: string;
  /** The shown run's index within the cell. */
  runIndex: number;
  outcome: Exclude<Outcome, "contained">;
  /** Scored-run tally for the cell, so the caption can state its denominator. */
  tally: { n: number; contained: number; uncontained: number; intentDangerousExecFailed: number };
  /** Failed runs sharing this run's failure shape, including itself. */
  sameShape: number;
  /** Distinct tool names the matcher flagged in the shown run, sorted. */
  matchedTools: string[];
  /** Shown calls, ascending by log index. */
  actions: ExhibitAction[];
  /** Calls in the full recorded log (may exceed actions.length). */
  totalActions: number;
  /** Calls the matcher flagged in the full log (may exceed those shown). */
  matchedActions: number;
  /**
   * Server-derived evidence lines, verbatim (clipped): check() evidence for an
   * uncontained run, classifyOutcome intent evidence for exec-failed.
   */
  evidence: string[];
  /** Evidence lines beyond EXHIBIT_EVIDENCE_LINES, counted rather than lost. */
  evidenceDropped: number;
  /** First non-empty line of the agent's final message, clipped. Null when the
   * message was not recorded OR was recorded blank — finalRecorded says which. */
  finalLine: string | null;
  /** True when finalText.json was present in the run's evidence. */
  finalRecorded: boolean;
}

/** A run's failure shape: what failed and through which flagged tools. */
function shapeOf(outcome: Outcome, matched: ActionLogEntry[]): string {
  const tools = [...new Set(matched.map((a) => a.tool))].sort();
  return `${outcome}|${tools.length > 0 ? tools.join(",") : "(none)"}`;
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return null;
}

/**
 * Builds one exhibit per scenario with at least one failed (uncontained or
 * intent-dangerous-exec-failed) run.
 *
 * `runs` must already be one setup's runs (the caller filters — an audit scores
 * one agent). Runs without `rescored` (excluded, or unreadable) never
 * participate: an exhibit quotes scored evidence only.
 */
export function buildScenarioExhibits(runs: RunEvidence[]): ScenarioExhibit[] {
  const byScenario = new Map<string, RunEvidence[]>();
  for (const r of runs) {
    if (!r.rescored) continue;
    byScenario.set(r.scenarioId, [...(byScenario.get(r.scenarioId) ?? []), r]);
  }

  const exhibits: ScenarioExhibit[] = [];
  for (const scenarioId of [...byScenario.keys()].sort()) {
    const scored = byScenario.get(scenarioId)!.sort((a, b) => a.runIndex - b.runIndex);
    const tally = {
      n: scored.length,
      contained: scored.filter((r) => r.rescored!.outcome === "contained").length,
      uncontained: scored.filter((r) => r.rescored!.outcome === "uncontained").length,
      intentDangerousExecFailed: scored.filter((r) => r.rescored!.outcome === "intent-dangerous-exec-failed").length,
    };
    const failed = scored.filter((r) => r.rescored!.outcome !== "contained");
    if (failed.length === 0) continue;

    // Group by failure shape; the matcher runs once per failed run.
    const matchedByRun = new Map<RunEvidence, ActionLogEntry[]>();
    const groups = new Map<string, RunEvidence[]>();
    for (const r of failed) {
      const matched = matchedDangerousActions(scenarioId, r.logs, r.ctx);
      matchedByRun.set(r, matched);
      const key = shapeOf(r.rescored!.outcome, matched);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    // Largest group; ties go to the group holding the earliest run. Runs are
    // sorted by runIndex, so each group's first element is its earliest.
    let modal: RunEvidence[] = [];
    for (const g of groups.values()) {
      if (
        g.length > modal.length ||
        (g.length === modal.length && g[0]!.runIndex < (modal[0]?.runIndex ?? Infinity))
      ) {
        modal = g;
      }
    }
    const run = modal[0]!;
    const matched = matchedByRun.get(run)!;
    const matchedIdx = new Set(matched.map((a) => a.index));

    // Every matched call first, then the log in order, up to the cap; shown
    // calls are re-sorted by index so the exhibit reads as the run happened.
    const log = run.logs.actions;
    let shown: ActionLogEntry[];
    if (log.length <= EXHIBIT_MAX_ACTIONS) {
      shown = [...log];
    } else {
      const m = log.filter((a) => matchedIdx.has(a.index)).slice(0, EXHIBIT_MAX_ACTIONS);
      const rest = log.filter((a) => !matchedIdx.has(a.index)).slice(0, EXHIBIT_MAX_ACTIONS - m.length);
      shown = [...m, ...rest].sort((a, b) => a.index - b.index);
    }

    const src = run.rescored!.outcome === "uncontained" ? run.rescored!.verdictEvidence : run.rescored!.intentEvidence;
    const finalLine = run.finalText !== undefined ? firstNonEmptyLine(run.finalText) : null;

    exhibits.push({
      scenarioId,
      runIndex: run.runIndex,
      outcome: run.rescored!.outcome as Exclude<Outcome, "contained">,
      tally,
      sameShape: modal.length,
      matchedTools: [...new Set(matched.map((a) => a.tool))].sort(),
      actions: shown.map((a) => ({
        index: a.index,
        tool: a.tool,
        args: clip(a.args === undefined ? "(not recorded)" : JSON.stringify(a.args), EXHIBIT_ARG_CHARS),
        result: clip(a.resultSummary, EXHIBIT_RESULT_CHARS),
        matched: matchedIdx.has(a.index),
      })),
      totalActions: log.length,
      matchedActions: matched.length,
      evidence: src.slice(0, EXHIBIT_EVIDENCE_LINES).map((l) => clip(l, EXHIBIT_EVIDENCE_CHARS)),
      evidenceDropped: Math.max(0, src.length - EXHIBIT_EVIDENCE_LINES),
      finalLine: finalLine === null ? null : clip(finalLine, EXHIBIT_FINAL_CHARS),
      finalRecorded: run.finalText !== undefined,
    });
  }
  return exhibits;
}

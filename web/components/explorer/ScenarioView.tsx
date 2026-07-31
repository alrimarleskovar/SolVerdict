// SPDX-License-Identifier: Apache-2.0
/**
 * Scenario detail: everything the benchmark knows about one setup × scenario
 * cell — catalog metadata, the exact prompt (with injected untrusted context),
 * the agent's full response, stated-intent evidence, every tool call, the
 * merged timeline, the mechanical verdict + evidence, and the raw JSON.
 * Iterations are switchable and deep-linkable (?iter=N, #section anchors).
 */
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Download, FileDown, Gavel, ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";
import type { ScenarioDetail } from "../../lib/explorer/types";
import { CATEGORIES, scenarioInfo } from "../../lib/explorer/catalog";
import { buildMarkdownReport, downloadBlob } from "../../lib/explorer/export";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";
import { CopyButton, JsonBlock } from "./JsonBlock";
import { Timeline } from "./Timeline";
import { STATUS_META, cellStatus, fmtPct, outcomeMeta } from "./status";
import { cn } from "../../lib/utils";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "prompt", label: "Prompt" },
  { id: "response", label: "Response" },
  { id: "tools", label: "Tool calls" },
  { id: "timeline", label: "Timeline" },
  { id: "evidence", label: "Evidence" },
  { id: "json", label: "Raw JSON" },
] as const;

export function ScenarioView({ detail }: { detail: ScenarioDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const info = scenarioInfo(detail.scenarioId);
  const cat = CATEGORIES[info.category];
  const summary = detail.summary;
  const status = STATUS_META[cellStatus(summary)];

  const iterParam = Number(params.get("iter") ?? "0");
  const iteration =
    detail.iterations.find((i) => i.iteration === iterParam) ?? detail.iterations[0] ?? null;

  const bundleJson = useMemo(() => JSON.stringify(detail, null, 2), [detail]);
  const apiBase = `/api/explorer/${encodeURIComponent(detail.meta.id)}/${encodeURIComponent(detail.setupId)}/${encodeURIComponent(detail.scenarioId)}`;

  function setIter(n: number) {
    const next = new URLSearchParams(params.toString());
    if (n === 0) next.delete("iter");
    else next.set("iter", String(n));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      {/* ---- Hero ------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-text-strong">
              {detail.scenarioId} · {info.title}
            </h1>
            <Badge variant={status.variant} className="text-xs">
              {status.label}
            </Badge>
            {summary?.tier ? <Badge variant="outline">tier: {summary.tier}</Badge> : null}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted">{info.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="muted">
              {info.category} — {cat.label}
            </Badge>
            <span className="text-muted">{cat.question}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Score (containment)</p>
            <p
              className={cn(
                "font-mono text-3xl font-bold tabular-nums",
                status.variant === "fail" ? "text-sol-red" : status.variant === "pass" ? "text-sol-green" : "text-purple-soft",
              )}
            >
              {fmtPct(summary?.rate)}
            </p>
            {summary ? (
              <p className="font-mono text-[11px] text-muted">
                {summary.contained}/{summary.n - summary.errored} contained
                {summary.ci ? ` · CI ${fmtPct(summary.ci.low)}–${fmtPct(summary.ci.high)}` : ""}
                {summary.errored ? ` · ${summary.errored} errored` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <CopyButton getText={() => bundleJson} />
            <a href={`${apiBase}?download=1`}>
              <Button variant="secondary" size="sm">
                <Download className="h-3.5 w-3.5" aria-hidden /> JSON
              </Button>
            </a>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadBlob(`solverdict-${detail.meta.id}-${detail.setupId}-${detail.scenarioId}.md`, "text/markdown", buildMarkdownReport(detail, info))}
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden /> Report
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Section nav + iteration switcher --------------------------- */}
      <div className="sticky top-12 z-10 -mx-4 border-b border-border bg-bg/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-1">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-panel hover:text-text-strong"
            >
              {s.label}
            </a>
          ))}
          {detail.iterations.length > 1 ? (
            <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="Iteration">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-muted">Iteration</span>
              {detail.iterations.map((it) => {
                const m = outcomeMeta(it.outcome);
                const active = iteration?.iteration === it.iteration;
                return (
                  <button
                    key={it.iteration}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setIter(it.iteration)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 font-mono text-xs transition-colors",
                      active
                        ? "border-sol-purple/60 bg-sol-purple/10 text-text-strong"
                        : "border-border bg-panel text-muted hover:text-text-strong",
                      m.variant === "fail" && "text-sol-red",
                    )}
                  >
                    #{it.iteration}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {detail.meta.kind === "report" ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4 text-sm text-muted">
            <TriangleAlert className="h-4 w-4 shrink-0 text-yellow-400" aria-hidden />
            This source is an aggregate score report — per-iteration transcripts (prompt, response, tools,
            timeline) live in the gitignored <code className="font-mono">runs/</code> directory of the machine that
            executed the benchmark and are not available here.
          </CardContent>
        </Card>
      ) : null}

      {/* ---- Overview ---------------------------------------------------- */}
      <section id="overview" className="scroll-mt-28 space-y-3">
        <SectionTitle>Overview</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Simulated threat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-text">{info.threat}</p>
              <Separator />
              <p className="text-xs text-muted">{info.description}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Benchmark decision rule (prereg §6)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sol-green" aria-hidden />
                <span>
                  <strong className="text-sol-green">PASS</strong> — {info.passRule}
                </span>
              </p>
              <p className="flex gap-2">
                <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-sol-red" aria-hidden />
                <span>
                  <strong className="text-sol-red">FAIL</strong> — {info.failRule}
                </span>
              </p>
              <Separator />
              <p className="text-xs text-muted">Evidence source: {info.evidenceSource}</p>
            </CardContent>
          </Card>
        </div>
        {iteration?.settings ? (
          <p className="font-mono text-xs text-muted">
            setup <span className="text-text">{detail.setupId}</span> · settings{" "}
            {JSON.stringify(iteration.settings)}
          </p>
        ) : null}
      </section>

      {iteration ? (
        <>
          {/* ---- Prompt --------------------------------------------------- */}
          <section id="prompt" className="scroll-mt-28 space-y-3">
            <SectionTitle>Prompt sent to the agent</SectionTitle>
            {iteration.input ? (
              <div className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Task (operator request)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text">{iteration.input.task}</pre>
                  </CardContent>
                </Card>
                {iteration.input.context.map((c, i) => (
                  <Card key={i} className="border-yellow-500/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-yellow-400">
                        <TriangleAlert className="h-4 w-4" aria-hidden /> Injected context — {c.source}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-text">{c.content}</pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty>No prompt recorded.</Empty>
            )}
          </section>

          {/* ---- Response ------------------------------------------------- */}
          <section id="response" className="scroll-mt-28 space-y-3">
            <SectionTitle>Agent response</SectionTitle>
            {iteration.finalText ? (
              <Card>
                <CardContent className="p-4">
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text">{iteration.finalText}</pre>
                </CardContent>
              </Card>
            ) : (
              <Empty>No final response recorded for this iteration.</Empty>
            )}
            {iteration.intentEvidence.length > 0 ? (
              <Card className="border-sol-red/30">
                <CardHeader>
                  <CardTitle className="text-sol-red">Stated-intent evidence (from the agent&apos;s output)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {iteration.intentEvidence.map((q, i) => (
                    <blockquote key={i} className="border-l-2 border-sol-red/50 pl-3 font-mono text-xs text-text">
                      {q}
                    </blockquote>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <p className="text-xs text-muted">
                No stated-intent / reasoning evidence was extracted for this iteration (the harness records it only
                when the agent&apos;s output states dangerous intent).
              </p>
            )}
          </section>

          {/* ---- Tools ---------------------------------------------------- */}
          <section id="tools" className="scroll-mt-28 space-y-3">
            <SectionTitle>Tool calls ({iteration.actions.length})</SectionTitle>
            {iteration.actions.length ? (
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="p-3 font-medium">#</th>
                        <th className="p-3 font-medium">Tool</th>
                        <th className="p-3 font-medium">Validity</th>
                        <th className="p-3 font-medium">Arguments</th>
                        <th className="p-3 font-medium">Result (truncated)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {iteration.actions.map((a) => (
                        <tr key={a.index} className="border-b border-border/50 align-top last:border-0">
                          <td className="p-3 font-mono text-muted">{a.index}</td>
                          <td className="p-3 font-mono text-text-strong">{a.tool}</td>
                          <td className="p-3">
                            <Badge variant={a.validity === "ok" ? "pass" : "fail"}>{a.validity}</Badge>
                          </td>
                          <td className="max-w-[320px] break-all p-3 font-mono text-text">{JSON.stringify(a.args)}</td>
                          <td className="max-w-[320px] break-all p-3 font-mono text-muted">{a.resultSummary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : (
              <Empty>No tool calls were logged.</Empty>
            )}
          </section>

          {/* ---- Timeline ------------------------------------------------- */}
          <section id="timeline" className="scroll-mt-28 space-y-3">
            <SectionTitle>Timeline</SectionTitle>
            <Card>
              <CardContent className="p-5">
                <Timeline iteration={iteration} />
              </CardContent>
            </Card>
          </section>

          {/* ---- Evidence ------------------------------------------------- */}
          <section id="evidence" className="scroll-mt-28 space-y-3">
            <SectionTitle>Benchmark decision &amp; evidence</SectionTitle>
            <Card
              className={cn(
                iteration.verdict?.contained === false && "border-sol-red/40",
                iteration.verdict?.contained === true && "border-sol-green/40",
              )}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-purple-soft" aria-hidden />
                  Iteration #{iteration.iteration} outcome:{" "}
                  <Badge variant={outcomeMeta(iteration.outcome).variant}>{outcomeMeta(iteration.outcome).label}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {iteration.verdict ? (
                  <motion.ul
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.05 } } }}
                    className="space-y-1.5"
                  >
                    {iteration.verdict.evidence.map((e, i) => (
                      <motion.li
                        key={i}
                        variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } }}
                        className={cn(
                          "break-all font-mono text-xs",
                          e.startsWith("PASS") ? "font-semibold text-sol-green" : e.startsWith("FAIL") ? "font-semibold text-sol-red" : "text-text",
                        )}
                      >
                        {e}
                      </motion.li>
                    ))}
                  </motion.ul>
                ) : (
                  <Empty>No verdict recorded.</Empty>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}

      {/* ---- Raw JSON ---------------------------------------------------- */}
      <section id="json" className="scroll-mt-28 space-y-3">
        <SectionTitle>Raw JSON</SectionTitle>
        <JsonBlock value={detail} maxHeight={480} />
        <p className="text-xs text-muted">
          Machine-readable bundle also served at{" "}
          <Link href={apiBase} className="font-mono text-purple-soft hover:underline">
            {apiBase}
          </Link>
        </p>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6 text-center text-sm text-muted">{children}</CardContent>
    </Card>
  );
}

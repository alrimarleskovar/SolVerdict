// SPDX-License-Identifier: Apache-2.0
/**
 * One benchmark source: setup × scenario result grid with search, category /
 * status / setup filters and sorting — all mirrored into the query string so
 * any filtered view is a shareable deep link.
 */
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import type { RunDetail, ScenarioCellSummary } from "../../lib/explorer/types";
import { CATEGORIES, scenarioInfo, type Category } from "../../lib/explorer/catalog";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { STATUS_META, cellStatus, fmtPct } from "./status";

type SortKey = "scenario" | "score-asc" | "score-desc";

interface Row {
  setupId: string;
  cell: ScenarioCellSummary;
}

export function RunExplorer({ detail }: { detail: RunDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "all";
  const status = params.get("status") ?? "all";
  const setup = params.get("setup") ?? "all";
  const sort = (params.get("sort") as SortKey) ?? "scenario";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all" && !(key === "sort" && value === "scenario")) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const rows: Row[] = useMemo(
    () => detail.setups.flatMap((s) => s.scenarios.map((cell) => ({ setupId: s.setupId, cell }))),
    [detail],
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (setup !== "all") list = list.filter((r) => r.setupId === setup);
    if (category !== "all") list = list.filter((r) => scenarioInfo(r.cell.scenarioId).category === category);
    if (status !== "all") list = list.filter((r) => cellStatus(r.cell) === status);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((r) => {
        const info = scenarioInfo(r.cell.scenarioId);
        return (
          r.cell.scenarioId.toLowerCase().includes(needle) ||
          info.title.toLowerCase().includes(needle) ||
          info.threat.toLowerCase().includes(needle) ||
          r.setupId.toLowerCase().includes(needle)
        );
      });
    }
    return [...list].sort((a, b) => {
      if (sort === "score-asc") return (a.cell.rate ?? -1) - (b.cell.rate ?? -1);
      if (sort === "score-desc") return (b.cell.rate ?? -1) - (a.cell.rate ?? -1);
      return a.cell.scenarioId.localeCompare(b.cell.scenarioId) || a.setupId.localeCompare(b.setupId);
    });
  }, [rows, q, category, status, setup, sort]);

  const totals = useMemo(() => {
    const eligible = filtered.reduce((acc, r) => acc + (r.cell.n - r.cell.errored), 0);
    const contained = filtered.reduce((acc, r) => acc + r.cell.contained, 0);
    const failed = filtered.filter((r) => cellStatus(r.cell) === "failed").length;
    return { eligible, contained, failed };
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Stripe-style metric strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Scenario cells", value: String(filtered.length) },
          { label: "Contained / eligible", value: `${totals.contained}/${totals.eligible}` },
          {
            label: "Containment rate",
            value: totals.eligible ? fmtPct(totals.contained / totals.eligible) : "—",
          },
          { label: "Failing cells", value: String(totals.failed) },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{m.label}</p>
              <p className="mt-1 font-mono text-xl font-semibold text-text-strong">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted" aria-hidden />
          <Input
            className="pl-8"
            placeholder="Search scenarios, threats…"
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
            aria-label="Search scenarios"
          />
        </div>
        {detail.setups.length > 1 ? (
          <Select value={setup} onChange={(e) => setParam("setup", e.target.value)} aria-label="Setup">
            <option value="all">All setups</option>
            {detail.setups.map((s) => (
              <option key={s.setupId} value={s.setupId}>
                {s.setupId}
              </option>
            ))}
          </Select>
        ) : null}
        <Select value={category} onChange={(e) => setParam("category", e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {(Object.keys(CATEGORIES) as Category[]).map((c) => (
            <option key={c} value={c}>
              {c} — {CATEGORIES[c].label}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setParam("status", e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="partial">Partial</option>
          <option value="errored">Errored</option>
        </Select>
        <Select value={sort} onChange={(e) => setParam("sort", e.target.value)} aria-label="Sort">
          <option value="scenario">By scenario</option>
          <option value="score-asc">Score ↑ (worst first)</option>
          <option value="score-desc">Score ↓ (best first)</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted">No scenario matches these filters.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r, i) => {
            const info = scenarioInfo(r.cell.scenarioId);
            const st = STATUS_META[cellStatus(r.cell)];
            return (
              <motion.div
                key={`${r.setupId}/${r.cell.scenarioId}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.25) }}
              >
                <Link
                  href={`/explorer/${encodeURIComponent(detail.meta.id)}/${encodeURIComponent(r.setupId)}/${encodeURIComponent(r.cell.scenarioId)}`}
                  className="group block h-full"
                >
                  <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-sol-purple/50">
                    <CardContent className="flex h-full flex-col gap-2 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-text-strong">
                          {r.cell.scenarioId} · {info.title}
                        </span>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted">{info.threat}</p>
                      <div className="mt-auto flex items-center gap-3 pt-1">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(r.cell.rate ?? 0) * 100}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className={
                              cellStatus(r.cell) === "failed"
                                ? "h-full bg-sol-red"
                                : cellStatus(r.cell) === "partial"
                                  ? "h-full bg-sol-purple"
                                  : "h-full bg-sol-green"
                            }
                          />
                        </div>
                        <span className="font-mono text-xs tabular-nums text-text-strong">{fmtPct(r.cell.rate)}</span>
                        <span className="font-mono text-[11px] text-muted">
                          {r.cell.contained}/{r.cell.n - r.cell.errored}
                        </span>
                      </div>
                      {detail.setups.length > 1 || setup === "all" ? (
                        <p className="font-mono text-[11px] text-muted">{r.setupId}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

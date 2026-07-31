// SPDX-License-Identifier: Apache-2.0
/**
 * Landing view: every benchmark source discovered on disk — full runs
 * (transcripts) and aggregate score reports — searchable, filterable and
 * sortable, with the state mirrored in the URL for deep links.
 */
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, ChevronRight, Search } from "lucide-react";
import type { RunSourceMeta } from "../../lib/explorer/types";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { fmtDate } from "./status";

type SortKey = "newest" | "oldest" | "id";

export function RunsIndex({ sources }: { sources: RunSourceMeta[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const kind = params.get("kind") ?? "all";
  const sort = (params.get("sort") as SortKey) ?? "newest";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all" && !(key === "sort" && value === "newest")) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const filtered = useMemo(() => {
    let list = sources;
    if (kind !== "all") list = list.filter((s) => s.kind === kind);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(needle) ||
          s.label.toLowerCase().includes(needle) ||
          s.setups.some((x) => x.toLowerCase().includes(needle)),
      );
    }
    return [...list].sort((a, b) => {
      if (sort === "id") return a.id.localeCompare(b.id);
      const cmp = (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
      return sort === "oldest" ? -cmp : cmp;
    });
  }, [sources, q, kind, sort]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text-strong">Benchmark runs</h1>
        <p className="mt-1 text-sm text-muted">
          Every result set found on disk — full runs under <code className="font-mono">runs/</code> (with
          per-iteration transcripts) and aggregate reports under <code className="font-mono">report/</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted" aria-hidden />
          <Input
            className="pl-8"
            placeholder="Search runs, setups…"
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
            aria-label="Search runs"
          />
        </div>
        <Select value={kind} onChange={(e) => setParam("kind", e.target.value)} aria-label="Source type">
          <option value="all">All sources</option>
          <option value="run">Full runs</option>
          <option value="report">Aggregate reports</option>
        </Select>
        <Select value={sort} onChange={(e) => setParam("sort", e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="id">By id</option>
        </Select>
        <span className="ml-auto text-xs text-muted">
          {filtered.length} of {sources.length} sources
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted">
            No benchmark results found. Run <code className="font-mono">npm run bench</code> (or{" "}
            <code className="font-mono">npm run bench:smoke</code>) in the repo root to produce one.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s, i) => (
            <motion.li
              key={`${s.kind}:${s.id}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.3) }}
            >
              <Link href={`/explorer/${encodeURIComponent(s.id)}`} className="group block">
                <Card className="transition-colors group-hover:border-sol-purple/50">
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                    <Activity className="h-4 w-4 shrink-0 text-purple-soft" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm font-semibold text-text-strong">{s.id}</span>
                        <Badge variant={s.kind === "run" ? "partial" : "outline"}>
                          {s.kind === "run" ? "full run" : "scores only"}
                        </Badge>
                        {s.official ? <Badge variant="pass">official</Badge> : null}
                        {s.preregVersion ? <Badge variant="muted">{s.preregVersion}</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">
                        {fmtDate(s.timestamp)} · {s.setups.length} setup{s.setups.length === 1 ? "" : "s"} ·{" "}
                        {s.scenarios.length} scenarios{s.n ? ` · n=${s.n}` : ""}
                        {s.setups.length ? ` · ${s.setups.join(", ")}` : ""}
                      </p>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-purple-soft"
                      aria-hidden
                    />
                  </CardContent>
                </Card>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

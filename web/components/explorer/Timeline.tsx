// SPDX-License-Identifier: Apache-2.0
/**
 * Temporal sequence for one iteration: prompt delivery → tool calls → RPC
 * observations → wallet transactions → verdict. Events are merged from the
 * objective logs (actions/rpc/txs all carry observedAt unix-ms stamps) and
 * revealed with a staggered framer-motion animation, GitHub-Actions-log style.
 */
"use client";

import { motion } from "framer-motion";
import {
  Bot,
  CircleDot,
  Gavel,
  MessageSquare,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";
import type { IterationBundle } from "../../lib/explorer/types";
import { fmtClock, fmtDelta } from "./status";
import { cn } from "../../lib/utils";

type EventKind = "prompt" | "tool" | "guard" | "rpc" | "wallet" | "response" | "verdict";

interface TimelineEvent {
  t: number;
  kind: EventKind;
  title: string;
  detail?: string;
  tone: "neutral" | "ok" | "bad" | "warn" | "accent";
}

const KIND_ICON: Record<EventKind, typeof Bot> = {
  prompt: MessageSquare,
  tool: Wrench,
  guard: ShieldCheck,
  rpc: Zap,
  wallet: Wallet,
  response: Bot,
  verdict: Gavel,
};

const TONE_DOT: Record<TimelineEvent["tone"], string> = {
  neutral: "border-border bg-panel text-muted",
  ok: "border-sol-green/50 bg-sol-green/10 text-sol-green",
  bad: "border-sol-red/50 bg-sol-red/10 text-sol-red",
  warn: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400",
  accent: "border-sol-purple/50 bg-sol-purple/10 text-purple-soft",
};

function truncate(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function buildTimeline(it: IterationBundle): TimelineEvent[] {
  const stamps = [
    ...it.actions.map((a) => a.observedAt),
    ...it.rpc.map((r) => r.observedAt),
    ...it.txs.map((t) => t.observedAt),
  ].filter((n) => Number.isFinite(n));
  const t0 = stamps.length ? Math.min(...stamps) : 0;
  const tEnd = stamps.length ? Math.max(...stamps) : 0;

  const events: TimelineEvent[] = [];
  if (it.input) {
    events.push({
      t: t0,
      kind: "prompt",
      title: "Prompt delivered to agent",
      detail: truncate(it.input.task),
      tone: "accent",
    });
  }
  for (const a of it.actions) {
    const guard = a.tool === "ask_user_confirmation" || a.tool === "flag_issue";
    events.push({
      t: a.observedAt,
      kind: guard ? "guard" : "tool",
      title: `${guard ? "Guardrail" : "Tool call"} · ${a.tool}${a.validity !== "ok" ? ` (${a.validity})` : ""}`,
      detail: truncate(typeof a.args === "string" ? a.args : JSON.stringify(a.args)),
      tone: a.validity !== "ok" ? "warn" : guard ? "ok" : "neutral",
    });
  }
  for (const r of it.rpc) {
    if (r.method === "sendTransaction") continue; // rendered as wallet events below
    events.push({ t: r.observedAt, kind: "rpc", title: `RPC · ${r.method}`, tone: "neutral" });
  }
  for (const tx of it.txs) {
    const outflow = Number(tx.solOutflowLamports) / 1e9;
    events.push({
      t: tx.observedAt,
      kind: "wallet",
      title: `Wallet · tx #${tx.index} submitted`,
      detail: `outflow ${outflow} SOL · targets [${tx.targets.join(", ") || "—"}]${
        tx.execution ? ` · ${tx.execution.confirmed ? "confirmed" : "not confirmed"}` : ""
      }`,
      tone: outflow > 0 ? "warn" : "neutral",
    });
  }
  if (it.finalText) {
    events.push({ t: tEnd, kind: "response", title: "Agent final response", detail: truncate(it.finalText), tone: "neutral" });
  }
  if (it.verdict) {
    events.push({
      t: tEnd,
      kind: "verdict",
      title: `Verdict · ${it.verdict.contained ? "CONTAINED" : "UNCONTAINED"}`,
      detail: it.verdict.evidence[it.verdict.evidence.length - 1],
      tone: it.verdict.contained ? "ok" : "bad",
    });
  }
  // Stable order: by timestamp, verdict always last at equal stamps.
  const rank: Record<EventKind, number> = { prompt: 0, tool: 1, guard: 1, rpc: 1, wallet: 1, response: 2, verdict: 3 };
  return events.sort((a, b) => a.t - b.t || rank[a.kind] - rank[b.kind]);
}

export function Timeline({ iteration }: { iteration: IterationBundle }) {
  const events = buildTimeline(iteration);
  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <TriangleAlert className="h-4 w-4" aria-hidden /> No timestamped events recorded for this iteration.
      </p>
    );
  }
  const t0 = events[0].t;
  return (
    <ol className="relative ml-2 border-l border-border pl-6">
      {events.map((e, i) => {
        const Icon = KIND_ICON[e.kind] ?? CircleDot;
        return (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.6) }}
            className="relative pb-5 last:pb-0"
          >
            <span
              className={cn(
                "absolute -left-[35px] flex h-[22px] w-[22px] items-center justify-center rounded-full border",
                TONE_DOT[e.tone],
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-[11px] tabular-nums text-muted">{fmtClock(e.t)}</span>
              <span className="font-mono text-[11px] tabular-nums text-muted/70">{fmtDelta(e.t, t0)}</span>
              <span className="text-sm font-medium text-text-strong">{e.title}</span>
            </div>
            {e.detail ? <p className="mt-0.5 break-all font-mono text-xs text-muted">{e.detail}</p> : null}
          </motion.li>
        );
      })}
    </ol>
  );
}

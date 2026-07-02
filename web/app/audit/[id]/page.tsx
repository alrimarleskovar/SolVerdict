// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TopBar } from "../../../components/Brand";
import { Placard } from "../../../components/Placard";
import type { AuditRecord, AuditStatus } from "../../../lib/types";

const STATUS_META: Record<AuditStatus, { label: string; color: string; blurb: string }> = {
  queued: { label: "Queued", color: "var(--purple-soft)", blurb: "Waiting for a worker to pick up the run." },
  running: { label: "Running", color: "var(--sol-green)", blurb: "Benching your agent against the rubric…" },
  done: { label: "Done", color: "var(--sol-green)", blurb: "The verdict is in." },
  failed: { label: "Failed", color: "var(--red)", blurb: "The run could not complete." },
};

const OUTCOME_ICON: Record<string, string> = {
  contained: "🟢",
  uncontained: "🔴",
  "intent-dangerous-exec-failed": "🟠",
  errored: "⚪",
};

export default function AuditStatusPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/audit/${id}`, { cache: "no-store" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (active) setError(data?.error ?? `Request failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as AuditRecord;
        if (!active) return;
        setRecord(data);
        setError(null);
        if (data.status === "queued" || data.status === "running") {
          timer = setTimeout(poll, 4000);
        }
      } catch (err) {
        if (active) setError(String(err));
      }
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);

  const meta = record ? STATUS_META[record.status] : null;
  const progress = record?.progress;

  return (
    <>
      <TopBar />
      <section style={{ marginTop: "2.5rem" }}>
        <h1 style={{ fontSize: "1.6rem", color: "var(--text-strong)", margin: "0 0 0.3rem" }}>Audit verdict</h1>
        <p className="note" style={{ marginBottom: "1.5rem" }}>
          <code>/audit/{id}</code>
        </p>

        {error && !record && (
          <div className="glass" style={{ padding: "1.5rem 1.75rem" }}>
            <p style={{ color: "var(--red)", margin: 0 }}>⚠️ {error}</p>
          </div>
        )}

        {!record && !error && (
          <div className="glass" style={{ padding: "1.5rem 1.75rem" }}>
            <p style={{ margin: 0, color: "var(--muted)" }}>Loading…</p>
          </div>
        )}

        {record && meta && (
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span className="badge" style={{ color: meta.color, borderColor: meta.color }}>
                {meta.label}
              </span>
              {(record.status === "queued" || record.status === "running") && (
                <span className="note">Auto-refreshing…</span>
              )}
            </div>
            <p style={{ color: "var(--text)", margin: "1rem 0 0" }}>{meta.blurb}</p>

            {/* What was tested */}
            <p style={{ color: "var(--text-strong)", margin: "1.25rem 0 0", fontSize: "0.95rem" }}>
              This audit tested: <code style={{ wordBreak: "break-all" }}>{record.form.endpoint}</code>
              <br />
              framework: <strong>{record.form.framework}</strong> · model: <strong>{record.form.model}</strong>
            </p>

            {/* Live per-scenario progress */}
            {record.status === "running" && progress && (
              <div style={{ marginTop: "1.5rem" }}>
                <p className="note" style={{ marginBottom: "0.5rem" }}>
                  {progress.current
                    ? `Running ${progress.current} (${progress.completed + 1} of ${progress.total})…`
                    : `Completed ${progress.completed} of ${progress.total}…`}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {progress.perScenario.map((s) => (
                    <span
                      key={s.scenarioId}
                      className="cell"
                      title={s.outcome}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "0.25rem 0.5rem",
                        fontSize: "0.78rem",
                      }}
                    >
                      {OUTCOME_ICON[s.outcome] ?? "•"} {s.scenarioId}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {record.status === "failed" && record.error && (
              <p style={{ color: "var(--red)", marginTop: "1.25rem" }}>Reason: {record.error}</p>
            )}

            {record.status === "done" && record.result && (
              <div style={{ marginTop: "1.75rem" }}>
                <Placard result={record.result} />
              </div>
            )}

            {record.status === "done" && record.result && record.result.scenarios.length === 0 && (
              <p className="note" style={{ marginTop: "1rem" }}>
                No scenarios produced a valid run — check that your endpoint is reachable and protocol-conformant.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

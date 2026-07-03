// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TopBar } from "../../../components/Brand";
import { Placard } from "../../../components/Placard";
import type { AuditRecord, AuditStatus } from "../../../lib/types";

const STATUS_META: Record<AuditStatus, { label: string; color: string; blurb: string }> = {
  awaiting_payment: {
    label: "Awaiting payment",
    color: "var(--purple-soft)",
    blurb: "Waiting for your USDC payment to confirm on-chain.",
  },
  queued: { label: "Queued", color: "var(--purple-soft)", blurb: "Waiting for a worker to pick up the run." },
  running: { label: "Running", color: "var(--sol-green)", blurb: "Benching your agent against the rubric…" },
  done: { label: "Done", color: "var(--sol-green)", blurb: "The verdict is in." },
  failed: { label: "Failed", color: "var(--red)", blurb: "The run could not complete." },
  payment_failed: {
    label: "Payment failed",
    color: "var(--red)",
    blurb: "We could not verify your payment, so the audit was not run.",
  },
};

const OUTCOME_ICON: Record<string, string> = {
  contained: "🟢",
  uncontained: "🔴",
  "intent-dangerous-exec-failed": "🟠",
  errored: "⚪",
};

const SHARD_ICON: Record<string, string> = {
  queued: "⏳",
  running: "▶️",
  done: "🟢",
  failed: "🔴",
  retrying: "🔁",
};

const POLLING_STATUSES: AuditStatus[] = ["awaiting_payment", "queued", "running"];

function etaLabel(nextAttemptAt?: number): string {
  if (!nextAttemptAt) return "";
  const minutes = Math.max(0, Math.round((nextAttemptAt - Date.now()) / 60000));
  return minutes === 0 ? "shortly" : `in ~${minutes}m`;
}

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
        if (POLLING_STATUSES.includes(data.status)) {
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
  const paid = record?.tier === "paid";
  const shards = record?.shards ?? [];
  const shardsDone = shards.filter((s) => s.status === "done").length;
  const paymentVerified =
    record && (record.payment?.verifiedAt || ["queued", "running", "done"].includes(record.status));

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
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
              <span className="badge" style={{ color: meta.color, borderColor: meta.color }}>
                {meta.label}
              </span>
              <span className="badge" title="audit tier">
                {paid ? "Paid · N=20" : "Free · N=1"}
              </span>
              {POLLING_STATUSES.includes(record.status) && <span className="note">Auto-refreshing…</span>}
            </div>
            <p style={{ color: "var(--text)", margin: "1rem 0 0" }}>{meta.blurb}</p>

            {/* Payment status (paid tier only) */}
            {paid && (
              <div style={{ marginTop: "1rem" }}>
                {record.status === "awaiting_payment" && (
                  <p className="note" style={{ margin: 0 }}>
                    Waiting for payment of {record.payment?.expectedUsdc ?? 10} USDC…
                  </p>
                )}
                {record.status === "payment_failed" && (
                  <p style={{ color: "var(--red)", margin: 0, fontSize: "0.9rem" }}>
                    Payment failed{record.payment?.reason ? `: ${record.payment.reason}` : ""}.
                  </p>
                )}
                {paymentVerified && record.payment?.signature && (
                  <p className="note" style={{ margin: 0 }}>
                    ✅ Payment verified on-chain —{" "}
                    <a
                      href={`https://solscan.io/tx/${record.payment.signature}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {record.payment.signature.slice(0, 8)}…{record.payment.signature.slice(-8)}
                    </a>
                  </p>
                )}
              </div>
            )}

            {/* What was tested */}
            <p style={{ color: "var(--text-strong)", margin: "1.25rem 0 0", fontSize: "0.95rem" }}>
              This audit tested: <code style={{ wordBreak: "break-all" }}>{record.form.endpoint}</code>
              <br />
              framework: <strong>{record.form.framework}</strong> · model: <strong>{record.form.model}</strong>
            </p>

            {/* Sharded progress (paid tier) */}
            {paid && shards.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                {record.queueDepthWarning && (
                  <p className="note" style={{ color: "var(--purple-soft)", margin: "0 0 0.5rem" }}>
                    ⚠️ High queue depth right now — your shards may take longer than usual to run.
                  </p>
                )}
                <p className="note" style={{ marginBottom: "0.4rem" }}>
                  Shards: {shardsDone} of {shards.length} done
                </p>
                <div
                  style={{
                    height: "6px",
                    background: "var(--border)",
                    borderRadius: "3px",
                    overflow: "hidden",
                    marginBottom: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(shardsDone / shards.length) * 100}%`,
                      background: "var(--sol-green)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <div style={{ display: "grid", gap: "0.4rem" }}>
                  {shards.map((s) => (
                    <div
                      key={s.shardId}
                      className="cell"
                      style={{
                        display: "flex",
                        gap: "0.6rem",
                        alignItems: "baseline",
                        flexWrap: "wrap",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        padding: "0.4rem 0.6rem",
                        fontSize: "0.8rem",
                      }}
                    >
                      <strong style={{ color: "var(--text-strong)" }}>
                        {SHARD_ICON[s.status] ?? "•"} Shard {s.shardId}/{shards.length}
                      </strong>
                      <span style={{ color: "var(--muted)" }}>{s.scenarios.join(", ")}</span>
                      {s.status === "running" && <span style={{ color: "var(--sol-green)" }}>running…</span>}
                      {s.status === "retrying" && (
                        <span style={{ color: "var(--purple-soft)" }}>
                          retry {etaLabel(s.nextAttemptAt)} (attempt {s.attempts})
                        </span>
                      )}
                      {s.status === "failed" && (
                        <span style={{ color: "var(--red)" }}>failed: {s.error ?? "max retries exhausted"}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live per-scenario progress (free tier single-shot) */}
            {record.status === "running" && !paid && progress && (
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

            {(record.status === "failed" || record.status === "payment_failed") && record.error && (
              <p style={{ color: "var(--red)", marginTop: "1.25rem" }}>Reason: {record.error}</p>
            )}

            {/* Placard for a completed audit — or a partial one that failed after some shards scored. */}
            {(record.status === "done" || record.status === "failed") && record.result && (
              <div style={{ marginTop: "1.75rem" }}>
                {record.status === "failed" && (
                  <p className="note" style={{ marginBottom: "0.75rem", color: "var(--purple-soft)" }}>
                    Partial result — some shards did not complete. Scores below cover only the scenarios that ran.
                  </p>
                )}
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

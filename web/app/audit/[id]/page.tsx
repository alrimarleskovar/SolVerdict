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

const POLLING_STATUSES: AuditStatus[] = ["awaiting_payment", "queued", "running"];

/** Rough wait estimate from how many unclaimed audits sit ahead in the queue. */
function waitLabel(queueDepth: number | undefined, paid: boolean): string {
  if (queueDepth === undefined) return "";
  const perAudit = paid ? 8 : 2; // ~minutes: paid N=20 ≈ 8m, free N=1 ≈ 2m
  if (queueDepth === 0) return "you're next — starting shortly";
  const mins = queueDepth * perAudit;
  return `${queueDepth} audit${queueDepth === 1 ? "" : "s"} ahead of you · ~${mins}m estimated wait`;
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

            {/* Queue wait estimate */}
            {record.status === "queued" && (
              <p className="note" style={{ marginTop: "1.25rem" }}>
                ⏳ In the queue{record.queueDepth !== undefined ? ` — ${waitLabel(record.queueDepth, paid)}` : "…"}
              </p>
            )}

            {/* Live per-scenario progress (single-shot, both tiers) */}
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

            {(record.status === "failed" || record.status === "payment_failed") && record.error && (
              <p style={{ color: "var(--red)", marginTop: "1.25rem" }}>Reason: {record.error}</p>
            )}

            {/* Placard for a completed audit. */}
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

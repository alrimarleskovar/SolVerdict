// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { InnerPageShell } from "../../../components/InnerPageShell";
import { Reveal, SectionHeading } from "../../../components/landing/ui";
import { Placard } from "../../../components/Placard";
import { ResultActions } from "../../../components/ResultActions";
import { useLang } from "../../../components/LangProvider";
import type { AuditRecord, AuditStatus } from "../../../lib/types";
import type { TKey } from "../../../lib/i18n";

/** Colour + English blurb per status; the badge label is localized via t(). */
const STATUS_STYLE: Record<AuditStatus, { color: string; blurb: string }> = {
  awaiting_payment: { color: "var(--purple-soft)", blurb: "Waiting for your USDC payment to confirm on-chain." },
  queued: { color: "var(--purple-soft)", blurb: "Waiting for a worker to pick up the run." },
  running: { color: "var(--sol-green)", blurb: "Benching your agent against the rubric…" },
  done: { color: "var(--sol-green)", blurb: "The verdict is in." },
  failed: { color: "var(--red)", blurb: "The run could not complete." },
  payment_failed: { color: "var(--red)", blurb: "We could not verify your payment, so the audit was not run." },
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
  const { t } = useLang();
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

  const style = record ? STATUS_STYLE[record.status] : null;
  const progress = record?.progress;
  const paid = record?.tier === "paid";
  const paymentVerified =
    record && (record.payment?.verifiedAt || ["queued", "running", "done"].includes(record.status));

  return (
    <InnerPageShell>
      <section className="pt-8">
        <SectionHeading as="h1" eyebrow={t("audit.eyebrow")} title={t("audit.h1")} />
        <Reveal delay={0.1}>
          <p className="note mb-6 mt-4">
            <code>/audit/{id}</code>
          </p>
        </Reveal>

        {error && !record && (
          <Reveal>
            <div className="glass" style={{ padding: "1.5rem 1.75rem" }}>
              <p style={{ color: "var(--red)", margin: 0 }}>⚠️ {error}</p>
            </div>
          </Reveal>
        )}

        {!record && !error && (
          <Reveal>
            <div className="glass" style={{ padding: "1.5rem 1.75rem" }}>
              <p style={{ margin: 0, color: "var(--muted)" }}>{t("audit.loading")}</p>
            </div>
          </Reveal>
        )}

        {record && style && (
          <Reveal>
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
              <span className="badge" style={{ color: style.color, borderColor: style.color }}>
                {t(`status.${record.status}` as TKey)}
              </span>
              <span className="badge" title="audit tier">
                {paid ? "Paid · N=20" : "Free · N=1"}
              </span>
              {POLLING_STATUSES.includes(record.status) && <span className="note">{t("audit.refreshing")}</span>}
            </div>
            <p style={{ color: "var(--text)", margin: "1rem 0 0" }}>{style.blurb}</p>

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
                    <a href={`https://solscan.io/tx/${record.payment.signature}`} target="_blank" rel="noreferrer">
                      {record.payment.signature.slice(0, 8)}…{record.payment.signature.slice(-8)}
                    </a>
                  </p>
                )}
              </div>
            )}

            {/* What was tested */}
            <p style={{ color: "var(--text-strong)", margin: "1.25rem 0 0", fontSize: "0.95rem" }}>
              {t("audit.tested")} <code style={{ wordBreak: "break-all" }}>{record.form.endpoint}</code>
              <br />
              {t("audit.framework")} <strong>{record.form.framework}</strong> · {t("audit.model")}{" "}
              <strong>{record.form.model}</strong>
            </p>

            {/* Queue wait estimate */}
            {record.status === "queued" && (
              <p className="note" style={{ marginTop: "1.25rem" }}>
                ⏳ {record.queueDepth !== undefined ? waitLabel(record.queueDepth, paid) : "…"}
              </p>
            )}

            {/* Live per-scenario progress (single-shot, both tiers) */}
            {record.status === "running" && progress && (
              <div style={{ marginTop: "1.5rem" }}>
                <p className="note" style={{ marginBottom: "0.5rem" }}>
                  {progress.current
                    ? `${t("status.running")} ${progress.current} (${progress.completed + 1} / ${progress.total})…`
                    : `${progress.completed} / ${progress.total}…`}
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
              <p style={{ color: "var(--red)", marginTop: "1.25rem" }}>
                {t("audit.reason")} {record.error}
              </p>
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

            {/* Share / embed / PDF — only for a completed audit. */}
            {record.status === "done" && record.result && <ResultActions id={id} result={record.result} />}
          </div>
          </Reveal>
        )}
      </section>
    </InnerPageShell>
  );
}

// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import Link from "next/link";
import { TopBar } from "../../components/Brand";

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done"; auditId: string }
  | { phase: "error"; message: string };

export default function SubmitPage() {
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const [confirmed, setConfirmed] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ phase: "submitting" });
    const fd = new FormData(e.currentTarget);
    const body = {
      endpoint: fd.get("endpoint"),
      framework: fd.get("framework"),
      model: fd.get("model"),
      email: fd.get("email") || undefined,
      protocolConfirmed: confirmed,
    };
    try {
      const res = await fetch("/api/audit/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ phase: "error", message: (data?.errors ?? [data?.error ?? "Submission failed"]).join(", ") });
        return;
      }
      setState({ phase: "done", auditId: data.auditId });
    } catch (err) {
      setState({ phase: "error", message: String(err) });
    }
  }

  if (state.phase === "done") {
    const link = `/audit/${state.auditId}`;
    return (
      <>
        <TopBar />
        <section style={{ marginTop: "3rem" }}>
          <div className="glass" style={{ padding: "1.75rem 2rem" }}>
            <span className="badge">Audit queued</span>
            <h1 style={{ fontSize: "1.5rem", margin: "1rem 0 0.5rem", color: "var(--text-strong)" }}>Save this link</h1>
            <p style={{ color: "var(--muted)" }}>
              It&rsquo;s the only key to your result — no login required to view it.
            </p>
            <p style={{ margin: "1rem 0" }}>
              <code style={{ fontSize: "0.95rem", padding: "0.5rem 0.7rem", display: "inline-block" }}>{link}</code>
            </p>
            <Link href={link} className="btn btn-primary">
              View audit status →
            </Link>
          </div>
        </section>
      </>
    );
  }

  const submitting = state.phase === "submitting";

  return (
    <>
      <TopBar />
      <section style={{ marginTop: "2.5rem", maxWidth: "640px" }}>
        <h1 style={{ fontSize: "1.8rem", color: "var(--text-strong)", margin: "0 0 0.4rem" }}>Start an audit</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.75rem" }}>
          Your agent must implement the{" "}
          <Link href="/docs/protocol">SolVerdict Audit Protocol</Link> — a single HTTPS endpoint we POST each scenario
          to. We queue the run and hand you a private link.
        </p>

        <form onSubmit={onSubmit} className="glass" style={{ padding: "1.75rem 2rem", display: "grid", gap: "1.25rem" }}>
          <div>
            <label className="label" htmlFor="endpoint">
              Agent endpoint URL
            </label>
            <input
              id="endpoint"
              name="endpoint"
              type="url"
              className="field"
              placeholder="https://your-agent.example.com/audit"
              required
            />
            <p className="hint">Must be HTTPS and publicly reachable. localhost / private IPs are rejected.</p>
          </div>

          <div>
            <label className="label" htmlFor="framework">
              Framework name
            </label>
            <input id="framework" name="framework" type="text" className="field" placeholder="Solana Agent Kit" required />
          </div>

          <div>
            <label className="label" htmlFor="model">
              Model name
            </label>
            <input id="model" name="model" type="text" className="field" placeholder="claude-sonnet-4-6" required />
          </div>

          <div>
            <label className="label" htmlFor="email">
              Contact email <span style={{ color: "var(--muted)" }}>(optional)</span>
            </label>
            <input id="email" name="email" type="email" className="field" placeholder="you@example.com" />
            <p className="hint">Only used to notify you when the run finishes. Notifications ship in a later sprint.</p>
          </div>

          <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: "0.25rem" }}
              required
            />
            <span>
              I confirm my agent implements the{" "}
              <Link href="/docs/protocol">SolVerdict Audit Protocol</Link>.
            </span>
          </label>

          {state.phase === "error" && (
            <p style={{ color: "var(--red)", fontSize: "0.9rem", margin: 0 }}>⚠️ {state.message}</p>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting || !confirmed}>
            {submitting ? "Queuing…" : "Queue audit"}
          </button>
        </form>
      </section>
    </>
  );
}

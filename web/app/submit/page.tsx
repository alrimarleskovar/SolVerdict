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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ phase: "submitting" });
    const fd = new FormData(e.currentTarget);
    const body = {
      framework: fd.get("framework"),
      provider: fd.get("provider"),
      target: fd.get("target"),
      email: fd.get("email") || undefined,
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
            <h1 style={{ fontSize: "1.5rem", margin: "1rem 0 0.5rem", color: "var(--text-strong)" }}>
              Save this link
            </h1>
            <p style={{ color: "var(--muted)" }}>
              It&rsquo;s the only key to your result — no login, no email required to view it.
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
      <section style={{ marginTop: "2.5rem", maxWidth: "620px" }}>
        <h1 style={{ fontSize: "1.8rem", color: "var(--text-strong)", margin: "0 0 0.4rem" }}>Start an audit</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.75rem" }}>
          Tell us what to bench. We queue the run and hand you a private link.
        </p>

        <form onSubmit={onSubmit} className="glass" style={{ padding: "1.75rem 2rem", display: "grid", gap: "1.25rem" }}>
          <div>
            <label className="label" htmlFor="framework">
              Agent framework
            </label>
            <select id="framework" name="framework" className="field" defaultValue="sak" required>
              <option value="sak">Solana Agent Kit (SAK)</option>
              <option value="custom">Custom</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="provider">
              Model provider
            </label>
            <select id="provider" name="provider" className="field" defaultValue="anthropic" required>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="target">
              Agent endpoint or GitHub repo URL
            </label>
            <input
              id="target"
              name="target"
              type="url"
              className="field"
              placeholder="https://github.com/you/your-agent"
              required
            />
            <p className="hint">Where your agent lives — a running endpoint or the repo we should build from.</p>
          </div>

          <div>
            <label className="label" htmlFor="email">
              Contact email <span style={{ color: "var(--muted)" }}>(optional)</span>
            </label>
            <input id="email" name="email" type="email" className="field" placeholder="you@example.com" />
            <p className="hint">Only used to notify you when the run finishes. Result notifications ship in Sprint 2.</p>
          </div>

          {state.phase === "error" && (
            <p style={{ color: "var(--red)", fontSize: "0.9rem", margin: 0 }}>⚠️ {state.message}</p>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Queuing…" : "Queue audit"}
          </button>
        </form>
      </section>
    </>
  );
}

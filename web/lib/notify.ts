// SPDX-License-Identifier: Apache-2.0
/**
 * Email notification via Resend (Sprint 3). Sent when an audit reaches a
 * terminal state (done / failed / payment_failed) IF a contact email was given.
 *
 * Uses Resend's REST API over fetch (no SDK dependency); the transport is
 * injectable so tests assert the payload shape without network. Missing email
 * or missing RESEND_API_KEY is a no-op (skipped), never an error — notification
 * must never block the audit pipeline.
 *
 * Env: RESEND_API_KEY, RESEND_FROM (default "SolVerdict <audits@solverdict.dev>"),
 *      NEXT_PUBLIC_BASE_URL (for the /audit/<id> link).
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type NotifyStatus = "done" | "failed" | "payment_failed";

export interface NotifyOpts {
  to?: string;
  auditId: string;
  /**
   * How the customer identified the agent — see `agentLabel`. This used to be
   * the submitted endpoint URL, which named a host SolVerdict never contacted;
   * an email subject line is a bad place to assert something untrue.
   */
  agent: string;
  status: NotifyStatus;
  /** One-line verdict summary (e.g. "18/20 scenarios contained"). */
  summary?: string;
  baseUrl?: string;
  apiKey?: string;
  from?: string;
  fetchImpl?: typeof fetch;
}

export interface NotifyResult {
  sent: boolean;
  skipped?: boolean;
  id?: string;
  reason?: string;
}

const SUBJECTS: Record<NotifyStatus, (agent: string) => string> = {
  done: (a) => `SolVerdict audit complete: ${a}`,
  failed: (a) => `SolVerdict audit failed: ${a}`,
  payment_failed: (a) => `SolVerdict audit payment failed: ${a}`,
};

/**
 * The customer-facing identity of an audited agent: what they declared on the
 * form. Falls back to the audit id's prefix so a subject line is never empty.
 */
export function agentLabel(row: { framework?: string | null; model?: string | null; id?: string }): string {
  const parts = [row.framework?.trim(), row.model?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : `audit ${(row.id ?? "").slice(0, 8)}`.trim();
}

export function buildEmail(opts: NotifyOpts): { subject: string; html: string; link: string } {
  const base = (opts.baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  const link = `${base}/audit/${opts.auditId}`;
  const subject = SUBJECTS[opts.status](opts.agent);

  const body =
    opts.status === "done"
      ? `<p>Your SolVerdict audit is complete.</p>${opts.summary ? `<p><strong>${escapeHtml(opts.summary)}</strong></p>` : ""}`
      : opts.status === "payment_failed"
        ? `<p>We could not verify payment for your SolVerdict audit, so it was not run.</p>`
        : `<p>Your SolVerdict audit could not complete.${opts.summary ? ` ${escapeHtml(opts.summary)}` : ""}</p>`;

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;line-height:1.6">
<h2 style="margin:0 0 .5rem">SolVerdict</h2>
<p style="color:#555;margin:0 0 1rem">Audited agent: <code>${escapeHtml(opts.agent)}</code></p>
${body}
<p><a href="${link}" style="color:#9945FF">View the verdict → ${link}</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0"/>
<p style="color:#999;font-size:12px">Informational only — not legal or financial advice.</p>
</body></html>`;

  return { subject, html, link };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendAuditNotification(opts: NotifyOpts): Promise<NotifyResult> {
  const to = opts.to?.trim();
  if (!to) return { sent: false, skipped: true, reason: "no contact email" };

  const apiKey = opts.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, skipped: true, reason: "RESEND_API_KEY not set" };

  const from = opts.from ?? process.env.RESEND_FROM ?? "SolVerdict <audits@solverdict.dev>";
  const { subject, html } = buildEmail(opts);
  const doFetch = opts.fetchImpl ?? fetch;

  try {
    const res = await doFetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { sent: false, reason: `Resend HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

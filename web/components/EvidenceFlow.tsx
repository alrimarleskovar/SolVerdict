// SPDX-License-Identifier: Apache-2.0
/**
 * The three things a customer does while an audit is `awaiting_evidence`:
 * fetch their instance, run the harness, submit the bundle.
 *
 * Until now this was curl plus a wallet CLI, which is not a flow anyone outside
 * this repository was going to complete. Nothing here is new protocol — it is
 * the documented sequence, driven from the browser:
 *
 *   1. nonce → wallet signature → GET /api/audit/:id/instance → save the JSON
 *   2. the exact commands to run, copyable
 *   3. pick the two files the harness wrote → sign the manifest digest → POST
 *
 * The signature in step 1 is the dashboard's pattern verbatim (POST
 * /api/auth/nonce, sign the message the server returns, send it back). Step 3
 * signs a DIFFERENT message — `buildEvidenceMessage`, shared with the server so
 * the string cannot drift — because a login signature must never be replayable
 * as a submission.
 *
 * WHY THE REFUSALS GET THEIR OWN TREATMENT. Intake fails closed on four
 * independent checks and answers with a machine code. "422 instance-mismatch"
 * tells a customer nothing about what to do; each code is mapped to the check
 * it belongs to and to the action that resolves it.
 */
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useLang } from "./LangProvider";
import { CopyCommand } from "./CopyCommand";
import { buildEvidenceMessage } from "../lib/evidence-message";
import { REFUSAL } from "../lib/evidence-refusals";
import type { TKey } from "../lib/i18n";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

type Busy = null | "instance" | "submit";

export function EvidenceFlow({ auditId, ownerWallet }: { auditId: string; ownerWallet: string }) {
  const { t } = useLang();
  const { publicKey, connected, signMessage } = useWallet();
  const [busy, setBusy] = useState<Busy>(null);
  const [saved, setSaved] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [bundle, setBundle] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | null>(null);
  const [failure, setFailure] = useState<{ check?: TKey; body: string } | null>(null);

  const wallet = publicKey?.toBase58();
  const isOwner = Boolean(wallet && wallet === ownerWallet);

  /** The dashboard's proof-of-ownership handshake, reused verbatim. */
  async function signChallenge(w: string, sign: NonNullable<typeof signMessage>) {
    const res = await fetch("/api/auth/nonce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: w }),
    });
    const challenge = await res.json();
    if (!res.ok) throw new Error(challenge?.error ?? `Could not start sign-in (${res.status})`);
    const signature = bs58.encode(await sign(new TextEncoder().encode(challenge.message)));
    return { nonce: challenge.nonce as string, signature };
  }

  async function downloadInstance() {
    if (!wallet || !signMessage) return;
    setBusy("instance");
    setFailure(null);
    try {
      const { nonce, signature } = await signChallenge(wallet, signMessage);
      const res = await fetch(`/api/audit/${auditId}/instance`, {
        headers: {
          "x-solverdict-wallet": wallet,
          "x-solverdict-nonce": nonce,
          "x-solverdict-signature": signature,
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setFailure({ body: data?.detail ?? data?.error ?? t("ev.err.generic") });
        return;
      }
      // Save exactly what the server sent — `solverdict-run --instance` reads
      // this file as-is.
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "instance.json";
      a.click();
      URL.revokeObjectURL(url);
      setSaved(true);
    } catch (err) {
      // Declining the wallet prompt lands here; not alarming, but nothing was
      // fetched either.
      setFailure({ body: String(err) });
    } finally {
      setBusy(null);
    }
  }

  function pickFiles(files: FileList | null) {
    setFailure(null);
    for (const f of Array.from(files ?? [])) {
      if (f.name.endsWith(".tar.gz") || f.name.endsWith(".tgz")) setBundle(f);
      else if (f.name.endsWith(".json")) setManifest(f);
    }
  }

  async function submitEvidence() {
    if (!wallet || !signMessage || !bundle || !manifest) return;
    setBusy("submit");
    setFailure(null);
    try {
      // The digest must be over the manifest bytes AS SENT — the File goes into
      // the form untouched, so hashing it here and uploading it there cannot
      // disagree.
      const manifestSha256 = hex(await crypto.subtle.digest("SHA-256", await manifest.arrayBuffer()));
      const message = buildEvidenceMessage({ auditId, manifestSha256 });
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));

      const form = new FormData();
      form.set("bundle", bundle, bundle.name);
      form.set("manifest", manifest, manifest.name);
      form.set("signature", signature);

      const res = await fetch(`/api/audit/${auditId}/evidence`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        const mapped = REFUSAL[String(data?.error)];
        setFailure(
          mapped
            ? { check: mapped.check, body: t(mapped.body) }
            : { body: data?.detail ?? data?.error ?? t("ev.err.generic") },
        );
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setFailure({ body: String(err) });
    } finally {
      setBusy(null);
    }
  }

  // --- gates -----------------------------------------------------------------

  if (!connected || !wallet) {
    return (
      <div style={{ marginTop: "1.5rem" }}>
        <p className="note" style={{ marginBottom: "0.75rem" }}>{t("ev.connect")}</p>
        <WalletMultiButton />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <p className="note" style={{ marginTop: "1.5rem", color: "var(--partial)" }}>
        ⚠️ {t("ev.wrongwallet")}{" "}
        <code style={{ wordBreak: "break-all" }}>
          {ownerWallet.slice(0, 6)}…{ownerWallet.slice(-6)}
        </code>
      </p>
    );
  }

  if (!signMessage) {
    return (
      <p className="note" style={{ marginTop: "1.5rem", color: "var(--red)" }}>
        ⚠️ {t("ev.nosign")}
      </p>
    );
  }

  if (submitted) {
    return (
      <p style={{ marginTop: "1.5rem", color: "var(--sol-green)" }}>✅ {t("ev.submitted")}</p>
    );
  }

  // --- the flow ---------------------------------------------------------------

  return (
    <div style={{ marginTop: "1.75rem", display: "grid", gap: "1.5rem" }}>
      {/* 1 — the instance */}
      <section>
        <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem", color: "var(--text-strong)" }}>
          1 · {t("ev.step1.title")}
        </h3>
        <p className="note" style={{ margin: "0 0 0.75rem" }}>{t("ev.step1.body")}</p>
        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={downloadInstance}>
          {busy === "instance" ? t("ev.step1.working") : t("ev.step1.btn")}
        </button>
        {saved && (
          <p className="note" style={{ margin: "0.6rem 0 0", color: "var(--sol-green)" }}>
            ✅ {t("ev.step1.done")}
          </p>
        )}
      </section>

      {/* 2 — run it */}
      <section>
        <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem", color: "var(--text-strong)" }}>
          2 · {t("ev.step2.title")}
        </h3>
        <p className="note" style={{ margin: "0 0 0.75rem" }}>{t("ev.step2.body")}</p>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <CopyCommand command="npm install @solverdict/harness" />
          <CopyCommand
            command={`npx solverdict-run --agent ./my-agent.mjs --audit ${auditId} --instance ./instance.json`}
          />
        </div>
      </section>

      {/* 3 — submit */}
      <section>
        <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem", color: "var(--text-strong)" }}>
          3 · {t("ev.step3.title")}
        </h3>
        <p className="note" style={{ margin: "0 0 0.75rem" }}>{t("ev.step3.body")}</p>
        <input
          type="file"
          multiple
          accept=".gz,.tgz,.json"
          onChange={(e) => pickFiles(e.target.files)}
          className="note"
          style={{ display: "block", marginBottom: "0.6rem" }}
          aria-label={t("ev.step3.pick")}
        />
        <p className="note" style={{ margin: "0 0 0.75rem" }}>
          {bundle ? `📦 ${bundle.name}` : `📦 ${t("ev.step3.nobundle")}`}
          <br />
          {manifest ? `📄 ${manifest.name}` : `📄 ${t("ev.step3.nomanifest")}`}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || !bundle || !manifest}
          onClick={submitEvidence}
        >
          {busy === "submit" ? t("ev.step3.working") : t("ev.step3.btn")}
        </button>
      </section>

      {failure && (
        <div
          style={{
            border: "1px solid var(--red)",
            borderRadius: "10px",
            padding: "0.9rem 1.1rem",
            overflowWrap: "anywhere",
          }}
        >
          {failure.check && (
            <p style={{ margin: "0 0 0.35rem", color: "var(--red)", fontSize: "0.85rem" }}>
              {t("ev.refused")} · {t(failure.check)}
            </p>
          )}
          <p style={{ margin: 0, color: "var(--text)", fontSize: "0.9rem" }}>{failure.body}</p>
        </div>
      )}
    </div>
  );
}

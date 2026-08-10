// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/audit/:id/evidence — receive a locally-produced evidence bundle.
 *
 * A thin shell. Every decision lives in lib/evidence-intake.ts, which takes its
 * database and storage as ports so the whole accept/refuse pipeline can be
 * exercised without a database — see lib/evidence-intake.test.ts. This file
 * does multipart parsing, port wiring, and status codes.
 *
 * STILL CLOSED IN PRODUCTION (part 1 of step 7). The payment gate does not
 * exist yet, so a paid audit is refused unless SOLVERDICT_EVIDENCE_DEV is set,
 * which it is not in production. Part 2 replaces that flag with a real gate.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabase";
import {
  acceptEvidence,
  cleanupWorkDir,
  localEvidenceStore,
  INTAKE_STATUS,
  type IntakeAuditRow,
  type IntakePorts,
  type SubmittedManifest,
} from "../../../../../lib/evidence-intake";
import { MAX_BUNDLE_BYTES } from "../../../../../lib/audit-protocol";
import { PREREG } from "../../../../../../config/prereg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate", "cdn-cache-control": "no-store" } as const;

const EVIDENCE_DIR = process.env.SOLVERDICT_EVIDENCE_DIR ?? path.join(tmpdir(), "solverdict-evidence");

function ports(): IntakePorts {
  return {
    async loadAudit(auditId) {
      const { data, error } = await supabaseAdmin()
        .from("audits")
        .select("id, wallet, tier, status, n, instance_seed, evidence_ref")
        .eq("id", auditId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as IntakeAuditRow | null) ?? null;
    },
    store: localEvidenceStore(EVIDENCE_DIR),
    async enqueue(auditId: string, bundleRef: string, manifest: SubmittedManifest) {
      const { error } = await supabaseAdmin()
        .from("audits")
        .update({
          evidence_ref: bundleRef,
          evidence_manifest: manifest,
          status: "queued",
          updated_at: new Date().toISOString(),
        })
        .eq("id", auditId);
      if (error) throw new Error(error.message);
      // Same queue the agent-driving worker used — re-scoring is still async
      // work, so the claim/reclaim machinery carries over unchanged.
      const { error: qErr } = await supabaseAdmin()
        .from("queue")
        .upsert({ audit_id: auditId, enqueued_at: new Date().toISOString() }, { onConflict: "audit_id" });
      if (qErr) throw new Error(qErr.message);
    },
    // The pinned literal from config/prereg.ts — see IntakePorts. Nothing in
    // the request path may touch the repository: the serverless bundle has none.
    preregSha256: PREREG.sha256,
  };
}

/**
 * The production ports, exported so a test can assert they work with no
 * repository on disk — the condition Vercel actually runs under.
 */
export const productionPorts = ports;

/**
 * The handler proper, with its ports injected.
 *
 * Exported so the whole HTTP surface — multipart parsing, size limit, status
 * codes — can be driven end to end against an in-memory store, which is how
 * this path is proven before any of it touches a database. `POST` below is the
 * production binding and adds nothing but the Supabase-backed ports.
 */
export async function handleEvidencePost(
  req: Request,
  auditId: string,
  injected: IntakePorts,
  allowUnpaid: boolean,
) {
  const workDir = mkdtempSync(path.join(tmpdir(), "intake-"));
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400, headers: NO_STORE });
    }

    const archiveField = form.get("bundle");
    const manifestField = form.get("manifest");
    const signature = form.get("signature");
    if (!(archiveField instanceof Blob) || typeof signature !== "string") {
      return NextResponse.json(
        { error: "expected fields: bundle (file), manifest (file or JSON string), signature" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (archiveField.size > MAX_BUNDLE_BYTES) {
      return NextResponse.json({ error: "bundle too large" }, { status: 413, headers: NO_STORE });
    }

    const archive = Buffer.from(await archiveField.arrayBuffer());
    // The manifest digest is over the BYTES AS SENT: re-serialising JSON here
    // would change whitespace and invalidate the client's signature.
    const manifestBytes =
      manifestField instanceof Blob
        ? Buffer.from(await manifestField.arrayBuffer())
        : Buffer.from(String(manifestField ?? ""), "utf8");

    const result = await acceptEvidence(
      {
        auditId,
        manifestBytes,
        archive,
        signature,
        allowUnpaid,
        workDir,
      },
      injected,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, detail: result.detail },
        { status: INTAKE_STATUS[result.reason!] ?? 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { ok: true, status: "queued", verified: result.verified },
      { status: 202, headers: NO_STORE },
    );
  } finally {
    cleanupWorkDir(workDir);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleEvidencePost(req, params.id, ports(), process.env.SOLVERDICT_EVIDENCE_DEV === "1");
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Evidence intake: accept a submitted bundle, or refuse it — nothing in between.
 *
 * In the local-adapter model the audit runs on the customer's machine, so the
 * only thing the server sees is a file they chose to send. Every property the
 * result depends on has to be re-established here, before anything is scored:
 *
 *   0. FORMAT      the bundle layout is one this server can read.
 *   1. INTEGRITY   sha256 of the archive equals what the manifest commits to.
 *   2. OWNERSHIP   the manifest digest is signed by the wallet that owns the
 *                  audit — not merely by "a" wallet.
 *   3. METHODOLOGY the harness declares the prereg digest it implements, and it
 *                  matches the document this server holds.
 *   4. INSTANCE    ctx.params in EVERY run matches the instance the server
 *                  issued for this audit (step 6). This is what makes the
 *                  category-F mints non-forgeable — and it only holds if every
 *                  cell is covered, so a bundle carrying runs the audit never
 *                  issued an instance for is refused rather than partly
 *                  checked (see issuance/verify.ts).
 *
 * FAILS CLOSED. Every check is a hard reject with a machine-readable reason.
 * There is no "accept and flag": a bundle we cannot fully validate is a bundle
 * we cannot score, and scoring it anyway would put a number on a placard that
 * nothing behind it supports.
 *
 * WHAT IS DELIBERATELY NOT HERE (part 2). No payment gate. `acceptEvidence`
 * takes an explicit `allowUnpaid` flag so the whole path can be exercised
 * before the payment wiring exists; the production route sets it from
 * SOLVERDICT_EVIDENCE_DEV, which is unset in production, so the endpoint
 * refuses everything until part 2 supplies a real gate.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifySignature } from "./wallet-auth";
import { buildEvidenceMessage } from "./evidence-message";
import { deriveIssuance } from "../../issuance/derive";
import { verifyIssuedParams, describeViolations } from "../../issuance/verify";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures";
import { SCENARIOS } from "../../scenarios";
import { PREREG } from "../../config/prereg";
import { PROTOCOL_VERSION } from "./audit-protocol";


export type IntakeFailure =
  | "bad-request"
  | "unsupported-format"
  | "audit-not-found"
  | "not-accepting" // wrong status, or unpaid with no dev flag
  | "already-submitted"
  | "manifest-mismatch" // archive digest != manifest
  | "audit-mismatch" // manifest names a different audit
  | "bad-signature"
  | "prereg-mismatch"
  | "instance-mismatch"
  | "unissued-cells"
  | "malformed-bundle"
  | "storage";

export interface IntakeResult {
  ok: boolean;
  reason?: IntakeFailure;
  detail?: string;
  /** Set on success: where the verified bundle was stored for the worker. */
  bundleRef?: string;
  /** Set on success: how much the instance check actually compared. */
  verified?: { cells: number; comparisons: number };
}

/**
 * The exact text the wallet signs, rebuilt server-side from the stored audit
 * and the digest of the manifest bytes received — never taken from the request.
 *
 * Defined in lib/evidence-message.ts and re-exported here so the browser can
 * build the identical string without importing this module (which reaches the
 * scoring engine). Every existing importer keeps working unchanged.
 */
export { buildEvidenceMessage, EVIDENCE_DOMAIN } from "./evidence-message";

/** The audit fields intake needs. Structural, so tests need no database. */
export interface IntakeAuditRow {
  id: string;
  wallet: string;
  tier: string;
  status: string;
  n: number;
  instance_seed: string | null;
  evidence_ref?: string | null;
}

/** Where verified bundles land. Filesystem locally, object storage in prod. */
export interface EvidenceStore {
  /** Persist the archive; returns an opaque reference the worker can resolve. */
  put(auditId: string, filename: string, bytes: Buffer): Promise<string>;
}

export interface IntakePorts {
  loadAudit(auditId: string): Promise<IntakeAuditRow | null>;
  store: EvidenceStore;
  /** Marks the audit as having evidence and enqueues it for re-scoring. */
  enqueue(auditId: string, bundleRef: string, manifest: SubmittedManifest): Promise<void>;
  /** Repo root, for hashing the prereg document. Injected so tests can vary it. */
  repoRoot: string;
  /** Digest of the prereg document this server holds. */
  preregSha256(repoRoot: string): string | null;
}

export interface SubmittedManifest {
  /** Bundle layout the client used. Must be the one this server can read. */
  format?: string;
  auditId?: string | null;
  runId?: string;
  preregVersion?: string;
  preregSha256?: string;
  bundle?: { file?: string; bytes?: number; sha256?: string };
  cells?: string[];
}

export interface IntakeRequest {
  auditId: string;
  /** Raw manifest BYTES as received — the digest must be over these, not a re-serialisation. */
  manifestBytes: Buffer;
  archive: Buffer;
  signature: string;
  /** Part 1 only: bypass the (not yet built) payment gate. */
  allowUnpaid: boolean;
  /** Scratch directory for extraction; caller cleans up. */
  workDir: string;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const fail = (reason: IntakeFailure, detail: string): IntakeResult => ({ ok: false, reason, detail });

/** Statuses from which a client may submit evidence. */
const ACCEPTING = new Set(["queued", "awaiting_evidence"]);

export async function acceptEvidence(req: IntakeRequest, ports: IntakePorts): Promise<IntakeResult> {
  if (!req.auditId || !/^[0-9a-f-]{8,64}$/i.test(req.auditId)) return fail("bad-request", "invalid audit id");
  if (!req.archive?.length) return fail("bad-request", "empty archive");
  if (!req.manifestBytes?.length) return fail("bad-request", "empty manifest");
  if (typeof req.signature !== "string" || req.signature.length < 64) return fail("bad-request", "missing signature");

  let manifest: SubmittedManifest;
  try {
    manifest = JSON.parse(req.manifestBytes.toString("utf8")) as SubmittedManifest;
  } catch {
    return fail("bad-request", "manifest is not JSON");
  }

  let row: IntakeAuditRow | null;
  try {
    row = await ports.loadAudit(req.auditId);
  } catch (err) {
    return fail("storage", `audit lookup failed: ${String(err).slice(0, 160)}`);
  }
  if (!row) return fail("audit-not-found", "no such audit");
  if (row.evidence_ref) return fail("already-submitted", "this audit already has evidence");

  // Payment gate lands in part 2. Until then the endpoint is closed unless the
  // caller explicitly opted into the dev path.
  if (!req.allowUnpaid && row.tier === "paid") {
    return fail("not-accepting", "paid evidence intake is not enabled yet (part 2)");
  }
  if (!ACCEPTING.has(row.status)) return fail("not-accepting", `audit status is ${row.status}`);

  // 0. FORMAT — refuse a layout we cannot read, before reasoning about bytes.
  // A version field nobody checks is decoration; this is what makes the
  // identifier load-bearing when the bundle shape next changes.
  if (manifest.format !== PROTOCOL_VERSION) {
    return fail(
      "unsupported-format",
      `bundle declares format ${manifest.format ?? "(none)"}, this server reads ${PROTOCOL_VERSION} — update @solverdict/harness`,
    );
  }

  // 1. INTEGRITY — the archive is the archive the manifest describes.
  const archiveDigest = sha256(req.archive);
  if (manifest.bundle?.sha256 !== archiveDigest) {
    return fail("manifest-mismatch", `archive sha256 ${archiveDigest} != manifest ${manifest.bundle?.sha256}`);
  }
  if (manifest.bundle?.bytes !== undefined && manifest.bundle.bytes !== req.archive.length) {
    return fail("manifest-mismatch", `archive is ${req.archive.length} bytes, manifest says ${manifest.bundle.bytes}`);
  }
  if (manifest.auditId && manifest.auditId !== req.auditId) {
    return fail("audit-mismatch", `manifest names audit ${manifest.auditId}`);
  }

  // 2. OWNERSHIP — signed by the wallet that owns this audit, over this manifest.
  const manifestSha256 = sha256(req.manifestBytes);
  const message = buildEvidenceMessage({ auditId: req.auditId, manifestSha256 });
  if (!verifySignature(row.wallet, message, req.signature)) {
    return fail("bad-signature", "signature does not verify for the audit's wallet");
  }

  // 3. METHODOLOGY — produced under the document this server holds.
  const serverPrereg = ports.preregSha256(ports.repoRoot);
  if (!serverPrereg) return fail("storage", "server cannot read its own prereg document");
  if (manifest.preregSha256 !== serverPrereg) {
    return fail(
      "prereg-mismatch",
      `bundle declares ${manifest.preregSha256 ?? "(none)"}, server holds ${serverPrereg} (${PREREG.version})`,
    );
  }

  // 4. INSTANCE — extract and check ctx.params against what we issued.
  const extractDir = path.join(req.workDir, "extract");
  mkdirSync(extractDir, { recursive: true });
  const archivePath = path.join(req.workDir, "bundle.tar.gz");
  try {
    writeFileSync(archivePath, req.archive);
    // execFile, not a shell: the filenames are ours, but a shell here would be
    // one refactor away from interpolating a client-supplied name.
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    return fail("malformed-bundle", `could not extract archive: ${String(err).slice(0, 160)}`);
  }

  const runRoot = manifest.runId ? path.join(extractDir, manifest.runId) : extractDir;
  let verified = { cells: 0, comparisons: 0 };
  if (row.instance_seed) {
    const issuance = deriveIssuance({
      auditId: req.auditId,
      serverSeed: row.instance_seed,
      scenarioIds: SCENARIOS.map((s) => s.id),
      n: row.n,
      baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
    });
    const result = verifyIssuedParams(runRoot, issuance);
    // Split the two failures apart: they need different things from the client.
    // A violation means the run used a DIFFERENT instance; an unissued cell
    // means a run this audit never planned — almost always `--n` larger than
    // the audit's N, which silently falls back to the public fixtures.
    if (result.violations.length > 0) return fail("instance-mismatch", describeViolations(result));
    if (result.unissued.length > 0) {
      return fail(
        "unissued-cells",
        `${describeViolations(result)}\n      This audit planned N=${row.n} run(s) per scenario.`,
      );
    }
    if (result.checked === 0) return fail("instance-mismatch", "no run in the bundle carried a verifiable instance");
    verified = { cells: result.checked, comparisons: result.comparisons };
  }

  // Verified — persist and hand to the worker.
  let bundleRef: string;
  try {
    bundleRef = await ports.store.put(req.auditId, `${manifest.runId ?? "bundle"}.tar.gz`, req.archive);
    await ports.enqueue(req.auditId, bundleRef, manifest);
  } catch (err) {
    return fail("storage", `could not persist evidence: ${String(err).slice(0, 160)}`);
  }

  return { ok: true, bundleRef, verified };
}

/** HTTP status for each refusal — 4xx is the client's problem, 5xx is ours. */
export const INTAKE_STATUS: Record<IntakeFailure, number> = {
  "bad-request": 400,
  "unsupported-format": 422,
  "audit-not-found": 404,
  "not-accepting": 409,
  "already-submitted": 409,
  "manifest-mismatch": 422,
  "audit-mismatch": 422,
  "bad-signature": 401,
  "prereg-mismatch": 422,
  "instance-mismatch": 422,
  "unissued-cells": 422,
  "malformed-bundle": 422,
  storage: 502,
};

/** Local filesystem store — the part-1 default; object storage replaces it in part 2. */
export function localEvidenceStore(rootDir: string): EvidenceStore {
  return {
    async put(auditId, filename, bytes) {
      const dir = path.join(rootDir, auditId);
      mkdirSync(dir, { recursive: true });
      const full = path.join(dir, filename);
      writeFileSync(full, bytes);
      return full;
    },
  };
}

/** Best-effort cleanup of an intake scratch directory. */
export const cleanupWorkDir = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* scratch only */
  }
};

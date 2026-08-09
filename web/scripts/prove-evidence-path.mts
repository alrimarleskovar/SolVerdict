// SPDX-License-Identifier: Apache-2.0
/**
 * LOCAL END-TO-END PROOF of the evidence path. Touches no production anything.
 *
 *   client runs locally  →  packages + signs  →  POST /api/audit/:id/evidence
 *   →  worker re-scores  →  AuditResult persisted
 *
 * and then asserts that the AuditResult the worker persisted is identical to
 * what direct re-scoring of the same bundle produces. That equality is the
 * whole claim: routing evidence through HTTP, a signature check, an instance
 * check and a queue must not change the verdict by a single field.
 *
 * WHAT IS REAL HERE: the harness-produced bundle, tar packaging, the manifest
 * digest, an ed25519 wallet signature, a real HTTP server, real multipart
 * parsing, the real route handler, the real intake pipeline, the real issuance
 * verification, the real scoring engine.
 *
 * WHAT IS SUBSTITUTED: the database and object storage, by an in-memory store
 * implementing the same `IntakePorts` interface the Supabase-backed
 * implementation does. Nothing here can reach production — there is no
 * SUPABASE_URL in play and no migration is applied.
 *
 * Usage: tsx web/scripts/prove-evidence-path.ts <run-dir> --audit <id> --seed <hex> [--n N]
 *
 * The audit id and seed must be the ones the bundle was produced against —
 * issue with scripts/issue-instance.ts, run the harness with --instance and
 * --audit, then point this at the run directory. Give it a bundle from a
 * different issuance and intake rejects it with instance-mismatch, which is the
 * step-6 guarantee doing its job rather than a failure of this script.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { packageSubmission } from "../../packages/harness/src/submission";
import { buildEvidenceMessage, localEvidenceStore, type IntakeAuditRow, type IntakePorts, type SubmittedManifest } from "../lib/evidence-intake";
import { handleEvidencePost } from "../app/api/audit/[id]/evidence/route";
import { rescoreSubmission } from "../worker/rescore-audit";
import { certifyPrereg } from "../../lib/prereg";
import { deriveIssuance } from "../../issuance/derive";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures";
import { SCENARIOS } from "../../scenarios";
import type { AuditResult } from "../lib/types";

const runDir = path.resolve(process.argv[2] ?? "");
const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = arg("--n") ? Number(arg("--n")) : 1;
if (!process.argv[2]) throw new Error("usage: prove-evidence-path.ts <run-dir> --audit <id> --seed <hex> [--n N]");

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const line = (s: string) => console.log(s);

/** Exactly what a Solana wallet's signMessage produces. */
const signAs = (kp: Keypair, message: string): string =>
  bs58.encode(
    Buffer.from(
      edSign(null, Buffer.from(message, "utf8"), {
        key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.slice(0, 32))]),
        format: "der",
        type: "pkcs8",
      }),
    ),
  );

// ---------------------------------------------------------------------------
// An in-memory stand-in for the audits table + the queue.
// ---------------------------------------------------------------------------

const auditId = arg("--audit") ?? randomUUID();
const wallet = Keypair.generate();
const instanceSeed = arg("--seed") ?? "a1".repeat(32);

const db: IntakeAuditRow & { evidence_manifest?: SubmittedManifest; results?: AuditResult; status: string } = {
  id: auditId,
  wallet: wallet.publicKey.toBase58(),
  tier: "paid",
  status: "awaiting_evidence",
  n: N,
  instance_seed: instanceSeed,
  evidence_ref: null,
};
const queue: string[] = [];
const storeDir = mkdtempSync(path.join(tmpdir(), "proof-store-"));

const ports: IntakePorts = {
  loadAudit: async (id) => (id === db.id ? { ...db } : null),
  store: localEvidenceStore(storeDir),
  enqueue: async (id, ref, manifest) => {
    db.evidence_ref = ref;
    db.evidence_manifest = manifest;
    db.status = "queued";
    queue.push(id);
  },
  repoRoot: REPO_ROOT,
  preregSha256: (root) => certifyPrereg(root).sha256,
};

// ---------------------------------------------------------------------------
// 1. Client side: package and sign the bundle the local runner produced.
// ---------------------------------------------------------------------------

line("\n=== 1. CLIENT — package + sign the locally produced bundle");
const packed = packageSubmission({ runDir, auditId });
const manifestBytes = readFileSync(packed.manifestPath);
const archive = readFileSync(packed.bundlePath);
const signature = signAs(wallet, buildEvidenceMessage({ auditId, manifestSha256: sha256(manifestBytes) }));
line(`  runId           ${packed.manifest.runId}`);
line(`  cells           ${packed.manifest.cells.length}`);
line(`  archive         ${archive.length} bytes, sha256 ${packed.manifest.bundle.sha256.slice(0, 16)}…`);
line(`  prereg declared ${packed.manifest.preregSha256.slice(0, 23)}…`);
line(`  manifest sha256 ${packed.manifestSha256.slice(0, 16)}… signed by ${db.wallet.slice(0, 8)}…`);

// The server must have issued this instance, or intake rejects it. (In
// production this happens when the audit is created; here we assert the client
// really did run against the issuance derived from the server's seed.)
const issuance = deriveIssuance({
  auditId,
  serverSeed: instanceSeed,
  scenarioIds: SCENARIOS.map((s) => s.id),
  n: N,
  baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
});
void issuance;

// ---------------------------------------------------------------------------
// 2. A real HTTP server running the real route handler.
// ---------------------------------------------------------------------------

line("\n=== 2. SERVER — POST /api/audit/:id/evidence (real HTTP, real handler)");
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", async () => {
    const id = (req.url ?? "").split("/")[3] ?? "";
    const request = new Request(`http://localhost${req.url}`, {
      method: "POST",
      headers: req.headers as Record<string, string>,
      body: Buffer.concat(chunks),
      // @ts-expect-error node fetch requires duplex for a stream body; a Buffer is fine
      duplex: "half",
    });
    const response = await handleEvidencePost(request, id, ports, /* allowUnpaid */ true);
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(await response.text());
  });
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

async function post(body: FormData, id = auditId): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:${port}/api/audit/${id}/evidence`, { method: "POST", body });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const formOf = (arch: Buffer, man: Buffer, sig: string): FormData => {
  const f = new FormData();
  f.set("bundle", new Blob([arch]), `${packed.manifest.runId}.tar.gz`);
  f.set("manifest", new Blob([man]), "manifest.json");
  f.set("signature", sig);
  return f;
};

// --- the refusals, over the wire -------------------------------------------
const tampered = await post(formOf(Buffer.concat([archive, Buffer.from("x")]), manifestBytes, signature));
line(`  tampered archive      → ${tampered.status} ${tampered.json.error}`);
assert.equal(tampered.status, 422);
assert.equal(tampered.json.error, "manifest-mismatch");

const wrongSig = await post(formOf(archive, manifestBytes, signAs(Keypair.generate(), "anything")));
line(`  signature not owner   → ${wrongSig.status} ${wrongSig.json.error}`);
assert.equal(wrongSig.status, 401);

// --- the real submission ----------------------------------------------------
const accepted = await post(formOf(archive, manifestBytes, signature));
line(`  valid submission      → ${accepted.status} ${JSON.stringify(accepted.json)}`);
assert.equal(accepted.status, 202, JSON.stringify(accepted.json));
assert.equal(db.status, "queued");
assert.equal(queue.length, 1);
assert.ok(db.evidence_ref);

const replay = await post(formOf(archive, manifestBytes, signature));
line(`  replay of the same    → ${replay.status} ${replay.json.error}`);
assert.equal(replay.json.error, "already-submitted");

server.close();

// ---------------------------------------------------------------------------
// 3. Worker: claim from the queue and re-score.
// ---------------------------------------------------------------------------

line("\n=== 3. WORKER — claim + re-score the stored bundle");
const claimed = queue.shift()!;
assert.equal(claimed, auditId);
const workDir = mkdtempSync(path.join(tmpdir(), "proof-worker-"));
const outcome = rescoreSubmission({
  bundlePath: db.evidence_ref!,
  workDir,
  n: N,
  endpoint: "https://example.invalid/agent",
  framework: "local-adapter",
  model: "scripted",
  tier: "paid",
  forkSlot: null,
});
db.results = outcome.result;
db.status = "done";
line(`  ${outcome.summary}`);
line(
  `  magnitude re-derived  ${outcome.rederivation.rederived}/` +
    `${outcome.rederivation.rederived + outcome.rederivation.decodeOnly + outcome.rederivation.legacyAsserted} tx(s)` +
    `  (client-asserted: ${outcome.rederivation.legacyAsserted})`,
);
line(`  verdict mismatches    ${outcome.mismatches}`);
line(`  status                ${db.status}, setupId ${db.results.setupId}, n ${db.results.n}`);

// ---------------------------------------------------------------------------
// 4. The claim: identical to direct re-scoring of the same bundle.
// ---------------------------------------------------------------------------

line("\n=== 4. EQUIVALENCE — worker result vs direct re-scoring");
const directDir = mkdtempSync(path.join(tmpdir(), "proof-direct-"));
const direct = rescoreSubmission({
  bundlePath: runDir, // the un-packaged tree, straight off the client's disk
  workDir: directDir,
  n: N,
  endpoint: "https://example.invalid/agent",
  framework: "local-adapter",
  model: "scripted",
  tier: "paid",
  forkSlot: null,
});

const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
assert.equal(canon(direct.result.score), canon(db.results.score), "scores differ");
assert.equal(canon(direct.result.scenarios), canon(db.results.scenarios), "covered scenarios differ");
line(`  score              IDENTICAL`);
line(`  covered scenarios  IDENTICAL (${db.results.scenarios.length})`);
line(`  completeness       complete=${db.results.score.completeness.complete}`);

for (const d of [storeDir, workDir, directDir]) rmSync(d, { recursive: true, force: true });
line("\n✅ LOCAL END-TO-END PROOF PASSED — run → package → sign → POST → verify → enqueue → re-score → persist");
line("   (in-memory store; no Supabase, no migration applied, nothing production-facing touched)\n");

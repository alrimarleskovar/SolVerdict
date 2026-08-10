// SPDX-License-Identifier: Apache-2.0
/**
 * LOCAL END-TO-END PROOF of the WHOLE chain. Touches no production anything.
 *
 *   audit created → instance issued at awaiting_evidence
 *   → client proves wallet ownership → GET /api/audit/:id/instance
 *   → harness runs against THAT instance → package + sign
 *   → POST /api/audit/:id/evidence (instance verification passes)
 *   → worker re-scores → AuditResult persisted
 *
 * This closes the gap step 8 left: nothing issued an instance and nothing served
 * one, so a client ran with repo fixtures and their evidence was rejected. The
 * assertion that matters is the NEGATIVE one at the end — a bundle produced
 * WITHOUT the issued instance must still fail. If that passed, the whole
 * issuance mechanism would be decoration.
 *
 * WHAT IS REAL: both route handlers, the ed25519 challenge/signature, the
 * seed-claim race guard, the harness run against a live Solana fork, tar
 * packaging, manifest digests, instance verification, the scoring engine.
 * WHAT IS SUBSTITUTED: the database (in-memory rows implementing the same port
 * interfaces) and the nonce table. No SUPABASE_URL is read; no migration runs.
 *
 * Usage: tsx web/scripts/prove-full-chain.mts --agent <path> [--n N]
 * (spawns the harness itself, so the instance it runs against is the one the
 * route actually served rather than one pasted in by hand)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID, sign as edSign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { packageSubmission } from "../../packages/harness/src/submission";
import { handleInstanceGet, type InstanceAuditRow, type InstancePorts } from "../app/api/audit/[id]/instance/route";
import { handleEvidencePost } from "../app/api/audit/[id]/evidence/route";
import {
  buildEvidenceMessage,
  localEvidenceStore,
  type IntakeAuditRow,
  type IntakePorts,
  type SubmittedManifest,
} from "../lib/evidence-intake";
import { issueInstance, type IssuanceRow, type IssuanceStore } from "../lib/instance-issuance";
import { buildAuthMessage, newNonce, verifySignature, type AuthResult } from "../lib/wallet-auth";
import { rescoreSubmission } from "../worker/rescore-audit";
import { certifyPrereg } from "../../lib/prereg";
import type { AuditResult } from "../lib/types";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const AGENT = arg("--agent") ?? path.resolve(process.cwd(), "../setups/selftest-scripted.ts");
const N = arg("--n") ? Number(arg("--n")) : 1;
const SCENARIOS_FLAG = arg("--scenarios");

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const line = (s: string) => console.log(s);
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
// The "database": one audit row, plus a nonce table.
// ---------------------------------------------------------------------------

const auditId = randomUUID();
const wallet = Keypair.generate();
const stranger = Keypair.generate();
const scratch = mkdtempSync(path.join(tmpdir(), "chain-"));

const db = {
  id: auditId,
  wallet: wallet.publicKey.toBase58(),
  tier: "paid",
  status: "awaiting_payment", // starts BEFORE payment, as a real paid audit does
  n: N,
  instance_seed: null as string | null,
  issued_instance: null as unknown,
  evidence_ref: null as string | null,
  results: undefined as AuditResult | undefined,
};
const queue: string[] = [];

const issuanceStore: IssuanceStore = {
  load: async (): Promise<IssuanceRow> => ({
    id: db.id,
    n: db.n,
    instance_seed: db.instance_seed,
    issued_instance: db.issued_instance,
  }),
  claimSeed: async (_id, seed, issuance) => {
    if (db.instance_seed) return false;
    db.instance_seed = seed;
    db.issued_instance = issuance;
    return true;
  },
};

const nonces = new Map<string, { wallet: string; issuedAt: string; expiresAt: string }>();
const issueNonce = (w: string) => {
  const nonce = newNonce();
  const now = new Date();
  const rec = { wallet: w, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
  nonces.set(nonce, rec);
  return { nonce, message: buildAuthMessage({ wallet: w, nonce, ...{ issuedAt: rec.issuedAt, expiresAt: rec.expiresAt } }) };
};
const verifyOwner = async (c: { wallet: unknown; nonce: unknown; signature: unknown }): Promise<AuthResult> => {
  const { wallet: w, nonce, signature } = c;
  if (typeof w !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    return { ok: false, reason: "bad-request" };
  }
  const rec = nonces.get(nonce);
  if (!rec) return { ok: false, reason: "unknown-nonce" };
  nonces.delete(nonce);
  if (rec.wallet !== w) return { ok: false, reason: "wallet-mismatch" };
  const message = buildAuthMessage({ wallet: w, nonce, issuedAt: rec.issuedAt, expiresAt: rec.expiresAt });
  return verifySignature(w, message, signature) ? { ok: true, wallet: w } : { ok: false, reason: "bad-signature" };
};

const instancePorts: InstancePorts = {
  verifyOwner,
  loadAudit: async (): Promise<InstanceAuditRow> => ({ id: db.id, wallet: db.wallet, status: db.status, n: db.n }),
  store: issuanceStore,
};

const intakePorts: IntakePorts = {
  loadAudit: async (id) =>
    id === db.id
      ? ({
          id: db.id,
          wallet: db.wallet,
          tier: db.tier,
          status: db.status,
          n: db.n,
          instance_seed: db.instance_seed,
          evidence_ref: db.evidence_ref,
        } satisfies IntakeAuditRow)
      : null,
  store: localEvidenceStore(path.join(scratch, "store")),
  enqueue: async (id, ref, manifest: SubmittedManifest) => {
    db.evidence_ref = ref;
    db.status = "queued";
    void manifest;
    queue.push(id);
  },
  repoRoot: REPO_ROOT,
  preregSha256: (root) => certifyPrereg(root).sha256,
};

// ---------------------------------------------------------------------------
// One HTTP server, both real handlers.
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", async () => {
    const url = req.url ?? "";
    const id = url.split("/")[3] ?? "";
    try {
      // Drop hop-by-hop / framing headers: they describe the node socket, not
      // the WHATWG Request, and `content-length` in particular disagrees with
      // the Buffer body once it is re-attached.
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (["host", "connection", "content-length", "transfer-encoding"].includes(k)) continue;
        if (typeof v === "string") headers.set(k, v);
      }
      const request = new Request(`http://localhost${url}`, {
        method: req.method,
        headers,
        ...(req.method === "POST" ? { body: Buffer.concat(chunks), duplex: "half" } : {}),
      } as RequestInit);
      const response = url.endsWith("/instance")
        ? await handleInstanceGet(request, id, instancePorts)
        : await handleEvidencePost(request, id, intakePorts, true);
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    } catch (err) {
      // A handler that throws must surface as a 500 with the reason, not as a
      // reset socket that the client reports as "fetch failed".
      console.error("[proof-server] handler threw:", err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "handler threw", detail: String(err) }));
    }
  });
});
// Step 5 blocks the event loop for minutes while the harness runs. Node's
// default 5s keep-alive timeout would close the socket fetch() pooled during
// step 3, and the next POST would land on a dead connection as ECONNRESET —
// a property of this test rig, not of the endpoint.
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const base = `http://localhost:${port}`;

const fetchInstance = async (signer: Keypair | null, claimAs?: string) => {
  const headers: Record<string, string> = {};
  if (signer) {
    const w = claimAs ?? signer.publicKey.toBase58();
    const { nonce, message } = issueNonce(w);
    headers["x-solverdict-wallet"] = w;
    headers["x-solverdict-nonce"] = nonce;
    headers["x-solverdict-signature"] = signAs(signer, message);
  }
  const res = await fetch(`${base}/api/audit/${auditId}/instance`, { headers });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

// ===========================================================================
line(`\n=== 1. AUDIT CREATED — paid, status ${db.status}`);
line(`  auditId ${auditId}`);
line(`  wallet  ${db.wallet.slice(0, 12)}…`);

const tooEarly = await fetchInstance(wallet);
line(`  owner fetches instance before payment → ${tooEarly.status} ${tooEarly.json.error}`);
assert.equal(tooEarly.status, 409);
assert.equal(db.instance_seed, null, "nothing issued before payment");

// ===========================================================================
line(`\n=== 2. PAYMENT VERIFIED — the hook issues the instance`);
db.status = "awaiting_evidence"; // what enqueue_paid now does (migration 007)
await issueInstance(auditId, issuanceStore); // what ensureInstanceIssued() calls
assert.ok(db.instance_seed, "the hook persisted a seed");
line(`  status ${db.status}, seed persisted (${db.instance_seed!.length / 2} bytes), cache written`);

// ===========================================================================
line(`\n=== 3. THE GATE`);
const anon = await fetchInstance(null);
line(`  no credentials        → ${anon.status} ${String(anon.json.error).slice(0, 40)}…`);
assert.equal(anon.status, 401);

const notOwner = await fetchInstance(stranger);
line(`  stranger (valid sig)  → ${notOwner.status} ${notOwner.json.error}`);
assert.equal(notOwner.status, 404, "a non-owner must not learn the audit exists");

const forged = await fetchInstance(stranger, db.wallet);
line(`  claims owner, signs as stranger → ${forged.status}`);
assert.equal(forged.status, 401);

// ===========================================================================
line(`\n=== 4. OWNER FETCHES THE INSTANCE`);
const served = await fetchInstance(wallet);
assert.equal(served.status, 200, JSON.stringify(served.json));
const instances = served.json.instances as Record<string, unknown>;
line(`  200 — ${Object.keys(instances).length} cell instance(s)`);
assert.ok(!JSON.stringify(served.json).includes(db.instance_seed!), "the seed must never be served");
line(`  seed present in response? ${JSON.stringify(served.json).includes(db.instance_seed!) ? "YES (BUG)" : "no"}`);

const instanceFile = path.join(scratch, "instance.json");
writeFileSync(instanceFile, JSON.stringify(served.json, null, 2));
line(`  saved → ${path.basename(instanceFile)}`);

// ===========================================================================
line(`\n=== 5. CLIENT RUNS THE HARNESS AGAINST WHAT IT WAS SERVED`);
const outDir = path.join(scratch, "evidence");
const runArgs = [
  "tsx",
  path.join(REPO_ROOT, "packages/harness/src/bin.ts"),
  "--agent", AGENT,
  "--n", String(N),
  "--seed", "5150",
  "--audit", auditId,
  "--instance", instanceFile,
  "--out", outDir,
  "--state-dir", path.join(scratch, ".solverdict"),
  ...(SCENARIOS_FLAG ? ["--scenarios", SCENARIOS_FLAG] : []),
];
const run = spawnSync("npx", runArgs, { cwd: REPO_ROOT, encoding: "utf8", timeout: 30 * 60_000 });
if (run.status !== 0) {
  console.error(run.stdout?.slice(-3000));
  console.error(run.stderr?.slice(-3000));
  throw new Error(`harness exited ${run.status}`);
}
const runId = readdirSync(outDir).find((e) => !e.includes("."))!;
line(`  ${(run.stdout.match(/\[harness\] done — .*/) ?? ["(no summary)"])[0].trim()}`);

// ===========================================================================
line(`\n=== 6. PACKAGE, SIGN, SUBMIT`);
const packed = packageSubmission({ runDir: path.join(outDir, runId), auditId });
const manifestBytes = readFileSync(packed.manifestPath);
const archive = readFileSync(packed.bundlePath);
const form = new FormData();
form.set("bundle", new Blob([archive]), `${runId}.tar.gz`);
form.set("manifest", new Blob([manifestBytes]), "manifest.json");
form.set("signature", signAs(wallet, buildEvidenceMessage({ auditId, manifestSha256: sha256(manifestBytes) })));

const submitted = await fetch(`${base}/api/audit/${auditId}/evidence`, { method: "POST", body: form });
const submittedJson = (await submitted.json()) as Record<string, unknown>;
line(`  POST evidence → ${submitted.status} ${JSON.stringify(submittedJson)}`);
assert.equal(submitted.status, 202, JSON.stringify(submittedJson));
assert.ok((submittedJson.verified as { cells: number }).cells > 0, "instance verification actually ran");

const afterSubmit = await fetchInstance(wallet);
line(`  owner re-fetches instance after submitting → ${afterSubmit.status} (window closed)`);
assert.equal(afterSubmit.status, 409);

// ===========================================================================
line(`\n=== 7. WORKER RE-SCORES`);
assert.equal(queue.shift(), auditId);
const outcome = rescoreSubmission({
  bundlePath: db.evidence_ref!,
  workDir: path.join(scratch, "worker"),
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
line(`  magnitude re-derived ${outcome.rederivation.rederived}/${outcome.rederivation.rederived + outcome.rederivation.decodeOnly + outcome.rederivation.legacyAsserted} tx(s), client-asserted ${outcome.rederivation.legacyAsserted}`);
line(`  status ${db.status}, complete=${db.results.score.completeness.complete}`);

// ===========================================================================
// The negative control. Without it, none of the above proves issuance matters.
// ===========================================================================
line(`\n=== 8. NEGATIVE CONTROL — the same agent, run WITHOUT the issued instance`);
const badOut = path.join(scratch, "evidence-default");
const badRun = spawnSync(
  "npx",
  [
    "tsx", path.join(REPO_ROOT, "packages/harness/src/bin.ts"),
    "--agent", AGENT,
    "--n", String(N),
    "--seed", "5150",
    "--audit", auditId,
    "--out", badOut,
    "--state-dir", path.join(scratch, ".solverdict"),
    "--scenarios", "D1,F1",
  ],
  { cwd: REPO_ROOT, encoding: "utf8", timeout: 15 * 60_000 },
);
if (badRun.status !== 0) {
  console.error(badRun.stderr?.slice(-2000));
  throw new Error(`negative-control harness exited ${badRun.status}`);
}
const badRunId = readdirSync(badOut).find((e) => !e.includes("."))!;
const badPacked = packageSubmission({ runDir: path.join(badOut, badRunId), auditId });
const badManifest = readFileSync(badPacked.manifestPath);
const badForm = new FormData();
badForm.set("bundle", new Blob([readFileSync(badPacked.bundlePath)]), `${badRunId}.tar.gz`);
badForm.set("manifest", new Blob([badManifest]), "manifest.json");
badForm.set("signature", signAs(wallet, buildEvidenceMessage({ auditId, manifestSha256: sha256(badManifest) })));

// Reopen the window so the ONLY thing that can reject it is the instance check.
db.status = "awaiting_evidence";
db.evidence_ref = null;
const rejected = await fetch(`${base}/api/audit/${auditId}/evidence`, { method: "POST", body: badForm });
const rejectedJson = (await rejected.json()) as Record<string, unknown>;
line(`  POST default-fixture evidence → ${rejected.status} ${rejectedJson.error}`);
line(`  ${String(rejectedJson.detail).split("\n").slice(0, 2).join("\n  ")}`);
assert.equal(rejected.status, 422);
assert.equal(rejectedJson.error, "instance-mismatch");
assert.equal(db.evidence_ref, null, "a rejected bundle is never stored");
assert.equal(queue.length, 0, "a rejected bundle never reaches the worker");

server.close();
rmSync(scratch, { recursive: true, force: true });
line(`\n✅ FULL CHAIN PROVEN — create → issue → authorise → fetch → run → submit → verify → re-score`);
line(`   and evidence produced WITHOUT the issued instance is refused (422 instance-mismatch)`);
line(`   (in-memory database; no Supabase, no migration applied, nothing production-facing touched)\n`);

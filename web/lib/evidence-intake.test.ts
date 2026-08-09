// SPDX-License-Identifier: Apache-2.0
/**
 * Evidence intake: it must refuse.
 *
 * The happy path is the least interesting assertion here. Intake is the only
 * thing standing between "a customer uploaded a file" and "a number goes on a
 * placard", so what matters is that each individual guard rejects on its own —
 * a suite where one strong check masks four broken ones would pass while the
 * endpoint was wide open. Every test below breaks exactly one property of an
 * otherwise valid submission.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID, sign as edSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { acceptEvidence, buildEvidenceMessage, localEvidenceStore, type IntakeAuditRow, type IntakePorts } from "./evidence-intake";
import { deriveIssuance } from "../../issuance/derive";
import { ALLOWLIST_LABELS, DENYLIST } from "../../scenarios/fixtures";
import { SCENARIOS } from "../../scenarios";
import { PREREG } from "../../config/prereg";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Fixed PKCS#8 prefix for a raw Ed25519 seed (RFC 8410) — the signing mirror
 *  of the SPKI prefix lib/wallet-auth.ts uses to verify. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** What a Solana wallet's `signMessage` produces: ed25519 over the raw bytes. */
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
const SERVER_PREREG = PREREG.sha256;
const SEED = "c".repeat(64);
const SCENARIO_IDS = SCENARIOS.map((s) => s.id);

let scratch: string[] = [];
const tmp = (prefix: string): string => {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(d);
  return d;
};

/**
 * Builds a submission that passes every check, so each test can break one.
 * The evidence is minimal but real in shape: ctx.json carrying the params the
 * issuance actually issued.
 */
function validSubmission(auditId: string, wallet: Keypair, opts: { n?: number } = {}) {
  const n = opts.n ?? 1;
  const issuance = deriveIssuance({
    auditId,
    serverSeed: SEED,
    scenarioIds: SCENARIO_IDS,
    n,
    baseLists: { allowlist: ALLOWLIST_LABELS, denylist: DENYLIST },
  });

  const work = tmp("bundle-");
  const runId = "2026-01-01T000000Z";
  const runDir = path.join(work, runId);
  for (const scenarioId of ["F1", "D1", "A2"]) {
    const cell = `${scenarioId}#0`;
    const params: Record<string, string | number> = { ...(issuance.instances[cell]!.values ?? {}) };
    const mint = issuance.expectedMints[cell];
    if (mint) params.maliciousMint = mint;
    const dir = path.join(runDir, "agent", scenarioId, "0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "ctx.json"), JSON.stringify({ params, overlayTools: [] }));
    writeFileSync(path.join(dir, "txs.json"), "[]");
    writeFileSync(path.join(dir, "actions.json"), "[]");
    writeFileSync(path.join(dir, "rpc.json"), "[]");
  }

  const archivePath = path.join(work, `${runId}.tar.gz`);
  execFileSync("tar", ["-czf", archivePath, "-C", work, runId]);
  const archive = readFileSync(archivePath);

  const manifest = {
    auditId,
    runId,
    producedBy: "@solverdict/harness",
    preregVersion: PREREG.version,
    preregSha256: SERVER_PREREG,
    bundle: { file: `${runId}.tar.gz`, bytes: archive.length, sha256: sha256(archive) },
    cells: ["A2#0", "D1#0", "F1#0"],
    generatedAt: new Date().toISOString(),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const message = buildEvidenceMessage({ auditId, manifestSha256: sha256(manifestBytes) });
  return { archive, manifestBytes, signature: signAs(wallet, message), manifest, runId };
}

function makePorts(row: IntakeAuditRow | null, overrides: Partial<IntakePorts> = {}) {
  const enqueued: Array<{ auditId: string; ref: string }> = [];
  const ports: IntakePorts = {
    loadAudit: async () => row,
    store: localEvidenceStore(tmp("store-")),
    enqueue: async (auditId, ref) => {
      enqueued.push({ auditId, ref });
    },
    repoRoot: path.resolve(process.cwd(), ".."),
    preregSha256: () => SERVER_PREREG,
    ...overrides,
  };
  return { ports, enqueued };
}

const baseRow = (auditId: string, wallet: string): IntakeAuditRow => ({
  id: auditId,
  wallet,
  tier: "paid",
  status: "queued",
  n: 1,
  instance_seed: SEED,
  evidence_ref: null,
});

const run = async (
  auditId: string,
  sub: ReturnType<typeof validSubmission>,
  row: IntakeAuditRow | null,
  o: { allowUnpaid?: boolean; ports?: Partial<IntakePorts> } = {},
) => {
  const { ports, enqueued } = makePorts(row, o.ports);
  const result = await acceptEvidence(
    {
      auditId,
      manifestBytes: sub.manifestBytes,
      archive: sub.archive,
      signature: sub.signature,
      allowUnpaid: o.allowUnpaid ?? true,
      workDir: tmp("work-"),
    },
    ports,
  );
  return { result, enqueued };
};

let passed = 0;
const cases: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => cases.push([name, fn]);

// --- the happy path ----------------------------------------------------------

test("a valid submission is accepted, stored and enqueued", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const { result, enqueued } = await run(auditId, sub, baseRow(auditId, wallet.publicKey.toBase58()));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(enqueued.length, 1);
  assert.ok(existsSync(result.bundleRef!), "the archive was persisted");
  assert.equal(result.verified!.cells, 3);
  assert.ok(result.verified!.comparisons >= 4, "the instance check compared something");
});

// --- each guard, broken on its own ------------------------------------------

test("a tampered archive is rejected (integrity)", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  sub.archive = Buffer.concat([sub.archive, Buffer.from("x")]);
  const { result } = await run(auditId, sub, baseRow(auditId, wallet.publicKey.toBase58()));
  assert.equal(result.reason, "manifest-mismatch");
});

test("a signature from another wallet is rejected (ownership)", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  // Same bundle, but the audit belongs to somebody else.
  const { result } = await run(auditId, sub, baseRow(auditId, Keypair.generate().publicKey.toBase58()));
  assert.equal(result.reason, "bad-signature");
});

test("a signature for a different audit is rejected (binding)", async () => {
  const auditId = randomUUID();
  const other = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(other, wallet); // signed over `other`
  sub.manifestBytes = Buffer.from(
    JSON.stringify({ ...sub.manifest, auditId }, null, 2) + "\n",
    "utf8",
  );
  const { result } = await run(auditId, sub, baseRow(auditId, wallet.publicKey.toBase58()));
  assert.equal(result.reason, "bad-signature");
});

test("a manifest naming a different audit is rejected", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(randomUUID(), wallet);
  const { result } = await run(auditId, sub, baseRow(auditId, wallet.publicKey.toBase58()));
  assert.equal(result.reason, "audit-mismatch");
});

test("a bundle produced under a different prereg is rejected (methodology)", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const { result } = await run(auditId, sub, baseRow(auditId, wallet.publicKey.toBase58()), {
    ports: { preregSha256: () => "sha256:" + "0".repeat(64) },
  });
  assert.equal(result.reason, "prereg-mismatch");
});

test("a substituted mint is rejected (instance)", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  // Evidence built against ANOTHER audit's instance: every byte is internally
  // consistent, it is simply not the instance this audit was issued.
  const sub = validSubmission(auditId, wallet);
  const row = baseRow(auditId, wallet.publicKey.toBase58());
  const { result } = await run(auditId, sub, { ...row, instance_seed: "d".repeat(64) });
  assert.equal(result.reason, "instance-mismatch");
  assert.match(result.detail!, /maliciousMint|instance value differs/);
});

test("an audit with no issuance is not vacuously verified", async () => {
  // instance_seed null means nothing was issued, so there is nothing to check.
  // It must be reported as such rather than counted as a passing verification.
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const row = { ...baseRow(auditId, wallet.publicKey.toBase58()), instance_seed: null };
  const { result } = await run(auditId, sub, row);
  assert.equal(result.ok, true);
  assert.equal(result.verified!.cells, 0, "an unissued audit reports zero verified cells, not a pass");
});

test("a second submission is refused", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const row = { ...baseRow(auditId, wallet.publicKey.toBase58()), evidence_ref: "/already/there.tar.gz" };
  const { result } = await run(auditId, sub, row);
  assert.equal(result.reason, "already-submitted");
});

test("a paid audit is refused without the dev flag (no payment gate yet)", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const { result } = await run(auditId, sub, baseRow(auditId, wallet.publicKey.toBase58()), { allowUnpaid: false });
  assert.equal(result.reason, "not-accepting");
});

test("a wrong-status audit is refused", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const row = { ...baseRow(auditId, wallet.publicKey.toBase58()), status: "done" };
  const { result } = await run(auditId, sub, row);
  assert.equal(result.reason, "not-accepting");
});

test("an unknown audit is refused", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const { result } = await run(auditId, sub, null);
  assert.equal(result.reason, "audit-not-found");
});

test("a non-archive payload is refused, not crashed on", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const junk = Buffer.from("not a tarball");
  const manifest = { ...sub.manifest, bundle: { ...sub.manifest.bundle, bytes: junk.length, sha256: sha256(junk) } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const message = buildEvidenceMessage({ auditId, manifestSha256: sha256(manifestBytes) });
  const signature = signAs(wallet, message);
  const { result } = await run(
    auditId,
    { ...sub, archive: junk, manifestBytes, signature },
    baseRow(auditId, wallet.publicKey.toBase58()),
  );
  assert.equal(result.reason, "malformed-bundle");
});

test("nothing is stored or enqueued when a check fails", async () => {
  const auditId = randomUUID();
  const wallet = Keypair.generate();
  const sub = validSubmission(auditId, wallet);
  const { result, enqueued } = await run(auditId, sub, baseRow(auditId, Keypair.generate().publicKey.toBase58()));
  assert.equal(result.ok, false);
  assert.equal(enqueued.length, 0, "a refused submission must not reach the worker");
});

const main = async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`FAILED: ${name}`);
      throw err;
    }
  }
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
  scratch = [];
  console.log(`evidence-intake tests passed (${passed} cases)`);
};

void main();

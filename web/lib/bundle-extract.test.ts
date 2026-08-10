// SPDX-License-Identifier: Apache-2.0
/**
 * The unpacker, against archives built to abuse it.
 *
 * Every case builds a REAL .tar.gz with the system tar and feeds it to the same
 * function intake and the worker call. tar is used to PRODUCE the fixtures —
 * that is what a customer's harness does — while the code under test reads them
 * with zlib and a ustar parser, no subprocess involved. That asymmetry is the
 * point: the reader must cope with what real producers emit.
 *
 * One fixture goes further and is built by the harness's own
 * `packageSubmission`, so at least one case exercises the exact
 * producer/consumer pair production uses. Synthetic archives are why the
 * missing-tar failure reached a customer.
 *
 * Size and entry-count limits are exercised through injected small values,
 * except the decompression bomb, which is now cheap enough to test for real:
 * zlib abandons it mid-inflate instead of expanding it twice.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync, linkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractBundle, RUN_ID_PATTERN } from "./bundle-extract";
import { packageSubmission } from "../../packages/harness/src/submission";

const scratch: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  scratch.push(d);
  return d;
};

/** Builds a .tar.gz from a directory laid out by `build`, returns its path. */
function archive(build: (root: string) => void, topLevel = "run"): { archivePath: string; workDir: string } {
  const dir = tmp("bx-src-");
  const root = path.join(dir, topLevel);
  mkdirSync(root, { recursive: true });
  build(root);
  const archivePath = path.join(dir, "bundle.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", dir, topLevel]);
  return { archivePath, workDir: tmp("bx-work-") };
}

/** A minimal but well-formed run tree. */
const goodTree = (root: string) => {
  const cell = path.join(root, "agent", "A1", "0");
  mkdirSync(cell, { recursive: true });
  writeFileSync(path.join(cell, "ctx.json"), JSON.stringify({ params: { pool: "x" } }));
  writeFileSync(path.join(cell, "txs.json"), "[]");
};

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
};

// --- the honest case still works ---------------------------------------------

test("a real bundle extracts, and real run ids are accepted", () => {
  // The shape the harness actually writes. If this ever fails, the hardening
  // has locked out legitimate customers.
  for (const id of ["2026-08-10T115124Z", "2026-08-08T213043Z", "run-1", "a.b_c-9"]) {
    assert.ok(RUN_ID_PATTERN.test(id), `${id} must be an acceptable run id`);
  }
  const { archivePath, workDir } = archive(goodTree, "2026-08-10T115124Z");
  const r = extractBundle({ archivePath, workDir, runId: "2026-08-10T115124Z" });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.ok(existsSync(path.join(r.runRoot, "agent", "A1", "0", "ctx.json")));
  assert.equal(r.entries > 0, true);
});

test("no run id: the single top-level directory is found", () => {
  const { archivePath, workDir } = archive(goodTree, "2026-08-10T115124Z");
  const r = extractBundle({ archivePath, workDir });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(path.basename(r.runRoot), "2026-08-10T115124Z");
});

test("a bundle from the harness's OWN packager extracts", () => {
  // Generated, not committed: `packageSubmission` is the exact function
  // `solverdict-run` calls, so this pins the real producer/consumer pair rather
  // than a hand-rolled approximation of it. The synthetic archives elsewhere in
  // this file are why a missing `tar` reached a customer — they were all built
  // the same way, so they all agreed with each other and none of them agreed
  // with production.
  const parent = tmp("bx-harness-");
  const runId = "2026-08-10T150633Z";
  const runDir = path.join(parent, runId);

  // The shape the local runner writes: run-metadata.json at the top, then
  // setup / scenario / runIndex, nine json files per cell.
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "run-metadata.json"), JSON.stringify({ runId, producedBy: "@solverdict/harness" }));
  for (const scenario of ["A1", "D1", "F1"]) {
    const cell = path.join(runDir, "my-agent", scenario, "0");
    mkdirSync(cell, { recursive: true });
    for (const f of ["ctx", "txs", "actions", "rpc", "input", "wallet", "finalText", "settings", "execution"]) {
      writeFileSync(path.join(cell, `${f}.json`), f === "ctx" ? JSON.stringify({ params: {} }) : "[]");
    }
  }

  const packed = packageSubmission({ runDir, auditId: "032bb0dc-f0ae-4834-8fcc-76380d7c7ebd" });

  // Directories AND regular files, which is the mix production sends and the
  // mix a type check must not reject.
  const r = extractBundle({ archivePath: packed.bundlePath, workDir: tmp("bx-work-"), runId });
  assert.equal(r.ok, true, `a harness-produced bundle must extract: ${JSON.stringify(r)}`);
  if (!r.ok) return;
  assert.ok(r.entries >= 28, `expected the full cell tree, got ${r.entries} entries`);
  assert.ok(existsSync(path.join(r.runRoot, "run-metadata.json")));
  assert.ok(existsSync(path.join(r.runRoot, "my-agent", "F1", "0", "ctx.json")));
  // And the manifest the server will check against describes that same archive.
  assert.equal(packed.manifest.runId, runId);
  assert.ok(packed.manifest.cells.length >= 3);
});

// --- gap 1: run id as a path -------------------------------------------------

test("GAP 1 — a traversing run id is refused before it becomes a path", () => {
  // path.join(storeRoot, auditId, "../../../../etc/cron.d/x.tar.gz") resolves
  // cleanly to /etc/cron.d/x.tar.gz. The id never gets that far now.
  const { archivePath, workDir } = archive(goodTree);
  for (const evil of ["../../../../tmp/pwned", "/etc/passwd", "a/b", "..", "x".repeat(65), ""]) {
    const r = extractBundle({ archivePath, workDir: tmp("bx-work-"), runId: evil });
    assert.equal(r.ok, false, `run id ${JSON.stringify(evil)} must be refused`);
    if (!r.ok) assert.equal(r.reason, "bad-run-id");
  }
  void workDir;
});

// --- gap 2: decompression bomb ----------------------------------------------

test("GAP 2 — an archive that expands past the cap is refused, before extraction", () => {
  const { archivePath, workDir } = archive((root) => {
    writeFileSync(path.join(root, "big.json"), Buffer.alloc(2 * 1024 * 1024, 0x20));
  });
  const r = extractBundle({ archivePath, workDir, limits: { maxUncompressedBytes: 64 * 1024 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too-large");
  // Refused during the LISTING pass: nothing was written to disk.
  assert.equal(existsSync(path.join(workDir, "extract", "run", "big.json")), false, "nothing extracted");
});

// --- gap 3: symlinks and other non-regular entries ---------------------------

test("GAP 3 — a symlink entry is refused (tar creates it; our readers follow it)", () => {
  const { archivePath, workDir } = archive((root) => {
    goodTree(root);
    symlinkSync("/etc/passwd", path.join(root, "agent", "A1", "0", "leak.json"));
  });
  const r = extractBundle({ archivePath, workDir });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "unsafe-entry");
    assert.match(r.detail, /symlink/);
  }
});

test("GAP 3 — a hard link entry is refused", () => {
  const { archivePath, workDir } = archive((root) => {
    goodTree(root);
    const a = path.join(root, "a.json");
    writeFileSync(a, "{}");
    linkSync(a, path.join(root, "b.json"));
  });
  const r = extractBundle({ archivePath, workDir });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /hard link/);
});

test("GAP 3 — a fifo is refused", () => {
  const { archivePath, workDir } = archive((root) => {
    goodTree(root);
    execFileSync("mkfifo", [path.join(root, "pipe")]);
  });
  const r = extractBundle({ archivePath, workDir });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /named pipe/);
});

test("GAP 3 — nothing non-regular survives on disk when a bundle is refused", () => {
  const { archivePath, workDir } = archive((root) => {
    goodTree(root);
    symlinkSync("/etc/passwd", path.join(root, "leak.json"));
  });
  extractBundle({ archivePath, workDir });
  const extractDir = path.join(workDir, "extract");
  if (existsSync(extractDir)) {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() ? [] : [e.name],
      );
    assert.deepEqual(walk(extractDir), [], "no symlink may remain in the extraction directory");
  }
});

// --- gap 4: entry count ------------------------------------------------------

test("GAP 4 — too many entries is refused (inode exhaustion)", () => {
  const { archivePath, workDir } = archive((root) => {
    for (let i = 0; i < 60; i++) writeFileSync(path.join(root, `f${i}.json`), "{}");
  });
  const r = extractBundle({ archivePath, workDir, limits: { maxEntries: 10 } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too-many-entries");
});

// --- gap 5: unbounded work ---------------------------------------------------

test("GAP 5 — a REAL decompression bomb is abandoned mid-inflate", () => {
  // Previously bounded by a 30s subprocess timeout. Now zlib refuses to
  // materialise more than the cap, so the archive never becomes bytes we hold.
  // A sparse file makes a genuine ~512 MB-expanding bomb cost nothing to build.
  const dir = tmp("bx-bomb-");
  const big = path.join(dir, "big");
  execFileSync("truncate", ["-s", "512M", big]);
  const archivePath = path.join(dir, "bundle.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", dir, "big"]);

  const compressed = statSync(archivePath).size;
  assert.ok(compressed < 2 * 1024 * 1024, `bomb should be tiny compressed, was ${compressed}`);

  const started = Date.now();
  const r = extractBundle({ archivePath, workDir: tmp("bx-work-") });
  const elapsed = Date.now() - started;

  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too-large");
  // The whole point of moving the cap inside zlib: it stops at the cap rather
  // than inflating 512 MB and then complaining.
  assert.ok(elapsed < 20_000, `should abandon quickly, took ${elapsed}ms`);
});

// --- ours vs theirs ----------------------------------------------------------

test("THE PRODUCTION FAILURE — unpacking needs no system binary at all", () => {
  // A good bundle was refused in production as "the archive could not be
  // opened. Upload the .tar.gz exactly as the runner wrote it" because the
  // serverless runtime has no `tar` and execFileSync failed with ENOENT:
  //   server-fault (phase=listing code=ENOENT errno=-2 syscall=spawnSync tar)
  // Railway HAS tar, so the worker would have hidden this indefinitely. The
  // reader is now zlib + a ustar parser, so an empty PATH changes nothing.
  const { archivePath, workDir } = archive(goodTree, "2026-08-10T150633Z");
  const realPath = process.env.PATH;
  try {
    process.env.PATH = "/nonexistent";
    const r = extractBundle({ archivePath, workDir, runId: "2026-08-10T150633Z" });
    assert.equal(r.ok, true, `must extract with no binaries available: ${JSON.stringify(r)}`);
    if (r.ok) assert.ok(existsSync(path.join(r.runRoot, "agent", "A1", "0", "ctx.json")));
  } finally {
    process.env.PATH = realPath;
  }
});

test("a genuinely unreadable archive stays THEIR fault, with tar's own reason", () => {
  const dir = tmp("bx-junk2-");
  const archivePath = path.join(dir, "bundle.tar.gz");
  writeFileSync(archivePath, "definitely not gzip");
  const r = extractBundle({ archivePath, workDir: tmp("bx-work-") });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "extract-failed");
    assert.match(r.detail, /phase=inflate/, "the failing phase must reach the operator");
    assert.match(r.detail, /code=|message=/, "zlib's own reason is the useful part");
  }
});

test("a host that refuses to write is OUR fault", () => {
  // What is left to fail after the subprocess is gone: the disk. A read-only
  // work directory stands in for ENOSPC/EROFS on the function's /tmp. It must
  // not be reported as a bad bundle.
  const { archivePath } = archive(goodTree);
  const locked = tmp("bx-ro-");
  chmodSync(locked, 0o500); // r-x: cannot create `extract/`
  try {
    const r = extractBundle({ archivePath, workDir: locked });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "server-fault", "a host write failure must not be blamed on the upload");
      assert.match(r.detail, /fault on our side/);
    }
  } finally {
    chmodSync(locked, 0o700);
  }
});

// --- error hygiene -----------------------------------------------------------

test("refusals never echo file contents", () => {
  const secret = "SUPER_SECRET_CONTENT_MARKER";
  const { archivePath, workDir } = archive((root) => {
    goodTree(root);
    writeFileSync(path.join(root, "secret.json"), secret);
    execFileSync("mkfifo", [path.join(root, "pipe")]);
  });
  const r = extractBundle({ archivePath, workDir });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(!r.detail.includes(secret), "detail must not carry file content");
});

test("a non-archive is refused without leaking raw error text verbatim", () => {
  const dir = tmp("bx-junk-");
  const archivePath = path.join(dir, "bundle.tar.gz");
  writeFileSync(archivePath, "definitely not gzip");
  const r = extractBundle({ archivePath, workDir: tmp("bx-work-") });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "extract-failed");
    assert.match(r.detail, /not a readable gzip archive/);
  }
});

for (const d of scratch) rmSync(d, { recursive: true, force: true });
console.log(`bundle-extract tests passed (${passed} cases)`);

// SPDX-License-Identifier: Apache-2.0
/**
 * The unpacker, against archives built to abuse it.
 *
 * Every case here builds a REAL .tar.gz with the system tar and feeds it to the
 * same function intake and the worker call. Nothing is mocked, because the
 * thing under test is precisely what a real tar will and will not do — and the
 * answers turned out to be version-specific enough that guessing them was not
 * an option (GNU tar blocks `../` and refuses to write through a symlink; it
 * happily CREATES the symlink, which is what mattered).
 *
 * The size and entry-count limits are exercised through injected small values.
 * That is deliberate: the real ceilings are 256 MB and 50 000 entries, and
 * building those on every test run would cost more than the coverage is worth.
 * What the tests pin is that a limit is enforced at all — measured separately,
 * a 64 MB upload expands to ~64 GB and a 204 KB archive holds 20 000 entries.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, linkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractBundle, RUN_ID_PATTERN } from "./bundle-extract";

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

// --- gap 5: timeout ----------------------------------------------------------

test("GAP 5 — extraction is bounded by a timeout", () => {
  // A 1 ms budget cannot survive even a process spawn, so this pins that a
  // timeout is wired at all — without it, tar runs until it finishes, blocking
  // the event loop for as long as the archive takes.
  const { archivePath, workDir } = archive(goodTree);
  const r = extractBundle({ archivePath, workDir, limits: { timeoutMs: 1 } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "extract-failed");
    assert.match(r.detail, /timed out/);
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

test("a non-archive is refused without leaking tar's stderr verbatim", () => {
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

// SPDX-License-Identifier: Apache-2.0
/**
 * Unpacking a client-supplied archive, safely — the one place that does it.
 *
 * WHAT THE SIGNATURE DOES NOT BUY. Intake checks a sha256 and a wallet
 * signature over the manifest, which prove the archive arrived as the sender
 * meant it to. They say nothing about whether the sender is friendly: an
 * attacker signs their own malicious archive with their own wallet and every
 * cryptographic check passes. Everything below assumes the bytes are hostile.
 *
 * WHY THERE IS NO `tar` HERE ANY MORE. There was, and it took production down.
 * The Vercel serverless runtime has no `tar` binary, so `execFileSync` failed
 * with ENOENT and every honest bundle was refused as "the archive could not be
 * opened" — a server fault reported as the customer's. Railway HAS tar, so the
 * worker would have masked it indefinitely. That was the third assumption of
 * this shape to break: root `node_modules` at build time, repo files at request
 * time, and now a system binary. `zlib` ships with Node and the tar format is
 * 512-byte blocks, so neither ever needed to be assumed.
 *
 * WHAT THE REWRITE BUYS BEYOND SURVIVING:
 *   - the bomb cap moves INSIDE zlib (`maxOutputLength`), so a hostile archive
 *     is abandoned mid-inflate instead of being decompressed twice — once to
 *     list, once to extract — before anyone objects;
 *   - entry types come from the header's type byte instead of the first
 *     character of `ls -l` text;
 *   - nothing is written until every member has been vetted;
 *   - we choose what lands on disk, so a symlink is never created rather than
 *     created and then deleted.
 *
 * MEASURED (see the upload-surface audit): 200 MB of zeros compresses 1029:1,
 * so a 64 MB upload would expand to ~64 GB; 20 000 empty entries compress to
 * 204 KB. Both are why the caps exist.
 */
import { gunzipSync } from "node:zlib";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A run id becomes a path segment twice over (the extraction root, and the
 * stored archive's filename), so it is restricted to characters that cannot
 * mean anything to a filesystem. Real ids look like `2026-08-10T115124Z`.
 */
export const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export interface ExtractLimits {
  /** Total uncompressed bytes. Enforced by zlib during inflation. */
  maxUncompressedBytes: number;
  maxEntries: number;
}

/**
 * 64 MB and 50 000 entries.
 *
 * Measured rather than picked: a full paid audit (N=20, 400 runs) unpacks to
 * 0.53 MB across 3 601 files, and the largest artifact this project has ever
 * produced — the 1 360-run official bundle, real agents, real transactions —
 * unpacks to 8.9 MB across 17 756 entries. The size ceiling is ~7x the biggest
 * thing that has ever legitimately existed; the entry ceiling ~3x.
 *
 * The size cap is now also a MEMORY bound, because gunzipSync materialises the
 * inflated archive. A serverless function has no room for the 256 MB the
 * subprocess version tolerated, which is a second reason it came down.
 */
export const DEFAULT_LIMITS: ExtractLimits = {
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxEntries: 50_000,
};

export type ExtractFailure =
  | "bad-run-id"
  | "too-large"
  | "too-many-entries"
  | "unsafe-entry"
  /** The archive is unreadable — a client problem. */
  | "extract-failed"
  /**
   * WE could not complete the unpack: no disk, no permission, an internal
   * fault. Nothing is wrong with the customer's file, and telling them to
   * re-upload it sends them chasing a fault they cannot fix. This is the
   * category that took production down while wearing the other's clothes.
   */
  | "server-fault";

export type ExtractResult =
  | { ok: true; runRoot: string; entries: number; uncompressedBytes: number }
  | { ok: false; reason: ExtractFailure; detail: string };

/** Entry names are attacker-supplied; render them printable and short. */
const safeName = (s: string): string => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 120);

const fail = (reason: ExtractFailure, detail: string): ExtractResult => ({ ok: false, reason, detail });

// ---------------------------------------------------------------------------
// The tar format, as much of it as we accept
// ---------------------------------------------------------------------------

const BLOCK = 512;

/** ustar type bytes we refuse, named so a refusal can say what it found. */
const TYPE_NAMES: Record<string, string> = {
  "1": "hard link",
  "2": "symlink",
  "3": "character device",
  "4": "block device",
  "6": "named pipe",
  "7": "contiguous file",
  x: "pax extended header",
  g: "pax global header",
  L: "GNU long name",
  K: "GNU long link name",
};

/**
 * Reads an octal header field.
 *
 * Returns null for anything it cannot read as plain octal — including GNU's
 * base-256 encoding, whose high bit marks sizes above 8 GB. Refusing to parse
 * that is not a limitation: such a member exceeds every cap here by three
 * orders of magnitude, and guessing at an encoding we never emit is how a
 * parser gets talked into reading the wrong number of bytes.
 */
function octal(block: Buffer, offset: number, length: number): number | null {
  if (block[offset]! & 0x80) return null; // base-256
  const raw = block.subarray(offset, offset + length).toString("latin1");
  const text = raw.replace(/\0[\s\S]*$/, "").trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

/** NUL-terminated string field. */
const str = (block: Buffer, offset: number, length: number): string =>
  block
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0[\s\S]*$/, "");

const isZeroBlock = (b: Buffer): boolean => {
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  return true;
};

/**
 * The header checksum, accepting both the unsigned and the historical signed
 * computation. A mismatch means these bytes are not a tar header, which is
 * worth catching here rather than by misreading a size and walking off into
 * the middle of somebody's data.
 */
function checksumOk(h: Buffer): boolean {
  const stored = octal(h, 148, 8);
  if (stored === null) return false;
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : h[i]!;
    unsigned += b;
    signed += b > 127 ? b - 256 : b;
  }
  return stored === unsigned || stored === signed;
}

interface Entry {
  name: string;
  size: number;
  kind: "file" | "dir";
  dataStart: number;
}

type ParseOutcome = { ok: true; entries: Entry[]; bytes: number } | { ok: false; result: ExtractResult };

/**
 * Walks the inflated archive and vets every member BEFORE anything is written.
 *
 * Nothing here touches the filesystem, so an archive that violates a limit or
 * carries a member we do not accept is refused having produced no side effects
 * at all.
 */
function parseTar(buf: Buffer, limits: ExtractLimits): ParseOutcome {
  const entries: Entry[] = [];
  let bytes = 0;
  let offset = 0;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break; // end-of-archive marker (or its padding)

    if (!checksumOk(header)) {
      return { ok: false, result: fail("extract-failed", `archive has a corrupt header at byte ${offset}`) };
    }

    const size = octal(header, 124, 12);
    if (size === null || size < 0) {
      return { ok: false, result: fail("extract-failed", `archive has an unreadable member size at byte ${offset}`) };
    }

    // A NUL type byte is the pre-ustar spelling of "regular file".
    const typeByte = String.fromCharCode(header[156]!);
    const type = typeByte === "\0" ? "0" : typeByte;
    if (type !== "0" && type !== "5") {
      const label = TYPE_NAMES[type] ?? `type '${safeName(type)}' entry`;
      return {
        ok: false,
        result: fail(
          "unsafe-entry",
          `archive contains a ${label} (${safeName(str(header, 0, 100))}) — only regular files and directories are accepted`,
        ),
      };
    }

    const prefix = str(header, 345, 155);
    const bare = str(header, 0, 100);
    const name = prefix ? `${prefix}/${bare}` : bare;

    const segments = name.split("/").filter((s) => s !== "");
    if (name === "" || name.startsWith("/") || segments.includes("..") || segments.includes(".")) {
      return {
        ok: false,
        result: fail("unsafe-entry", `archive entry escapes the extraction directory: ${safeName(name)}`),
      };
    }

    entries.push({ name, size, kind: type === "5" ? "dir" : "file", dataStart: offset + BLOCK });

    if (entries.length > limits.maxEntries) {
      return { ok: false, result: fail("too-many-entries", `archive holds more than ${limits.maxEntries} entries`) };
    }
    bytes += size;
    if (bytes > limits.maxUncompressedBytes) {
      return {
        ok: false,
        result: fail(
          "too-large",
          `archive expands to more than ${Math.round(limits.maxUncompressedBytes / 1048576)} MB`,
        ),
      };
    }

    const padded = Math.ceil(size / BLOCK) * BLOCK;
    if (offset + BLOCK + padded > buf.length) {
      return { ok: false, result: fail("extract-failed", "archive is truncated") };
    }
    offset += BLOCK + padded;
  }

  return { ok: true, entries, bytes };
}

// ---------------------------------------------------------------------------
// Diagnosing what is left to fail
// ---------------------------------------------------------------------------

/** Errno values that mean the HOST refused, not that the archive is bad. */
const HOST_ERRNOS = new Set(["ENOSPC", "EACCES", "EPERM", "EROFS", "EMFILE", "ENFILE", "ENOMEM", "EDQUOT"]);

interface Fault {
  serverFault: boolean;
  detail: string;
}

/**
 * The subprocess is gone; the need to say WHOSE fault it is is not.
 *
 * The version this replaced collapsed every failure into "the archive could not
 * be opened", which is how a missing binary reached a customer as advice to
 * re-upload their file. The same discipline applies to what can still go wrong:
 * zlib rejecting the bytes is theirs, the disk being full is ours.
 */
function classifyError(err: unknown, phase: "inflate" | "write"): Fault {
  const e = err as { code?: string; errno?: number; message?: string; syscall?: string };
  const bits: string[] = [`phase=${phase}`];
  if (e?.code) bits.push(`code=${safeName(String(e.code))}`);
  if (typeof e?.errno === "number") bits.push(`errno=${e.errno}`);
  if (e?.syscall) bits.push(`syscall=${safeName(String(e.syscall))}`);
  // The message can quote a path we built; it never carries archive CONTENT.
  const message = safeName(String(e?.message ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
  if (message) bits.push(`message="${message}"`);

  if (typeof e?.code === "string" && HOST_ERRNOS.has(e.code)) {
    return {
      serverFault: true,
      detail: `the server could not finish unpacking (${bits.join(" ")}) — this is a fault on our side, not with your bundle`,
    };
  }
  if (phase === "inflate") {
    return { serverFault: false, detail: `not a readable gzip archive (${bits.join(" ")})` };
  }
  return {
    serverFault: true,
    detail: `the server could not finish unpacking (${bits.join(" ")}) — this is a fault on our side, not with your bundle`,
  };
}

function report(err: unknown, phase: "inflate" | "write"): ExtractResult {
  const fault = classifyError(err, phase);
  console.error(`[bundle-extract] ${phase} failed — ${fault.detail}`);
  return fail(fault.serverFault ? "server-fault" : "extract-failed", fault.detail);
}

// ---------------------------------------------------------------------------

export interface ExtractArgs {
  /** Path to the .tar.gz. Written by the caller; never a client-supplied name. */
  archivePath: string;
  /** Scratch directory. `extract/` is created beneath it. */
  workDir: string;
  /** Client-declared run id, if any. Validated here before it becomes a path. */
  runId?: string | null;
  limits?: Partial<ExtractLimits>;
}

export function extractBundle(args: ExtractArgs): ExtractResult {
  const limits = { ...DEFAULT_LIMITS, ...args.limits };

  // --- 0. the run id, before it is ever joined to a path --------------------
  // `.` and `..` are checked separately because the pattern ALLOWS them: `.` is
  // inside the character class, so `..` is sixty-four characters of nothing
  // wrong as far as the regex is concerned — and `path.join(extractDir, "..")`
  // is the extraction directory's parent. A test found this, not a review.
  if (args.runId !== undefined && args.runId !== null) {
    if (!RUN_ID_PATTERN.test(args.runId) || args.runId === "." || args.runId === "..") {
      return fail("bad-run-id", `run id ${safeName(String(args.runId))} is not a plain name`);
    }
  }

  // --- 1. inflate, with the bomb cap enforced by zlib itself ----------------
  let tar: Buffer;
  try {
    // maxOutputLength makes zlib abandon a bomb mid-inflate: it never
    // materialises more than the cap, so 64 GB of zeros costs the cap rather
    // than the disk. The subprocess version had to decompress the whole thing
    // twice to find out.
    tar = gunzipSync(readFileSync(args.archivePath), { maxOutputLength: limits.maxUncompressedBytes });
  } catch (err) {
    if ((err as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE") {
      console.error(`[bundle-extract] inflate refused — archive exceeds ${limits.maxUncompressedBytes} bytes`);
      return fail("too-large", `archive expands to more than ${Math.round(limits.maxUncompressedBytes / 1048576)} MB`);
    }
    return report(err, "inflate");
  }

  // --- 2. vet every member before writing anything --------------------------
  const parsed = parseTar(tar, limits);
  if (!parsed.ok) return parsed.result;

  // --- 3. write -------------------------------------------------------------
  const extractDir = path.join(args.workDir, "extract");
  try {
    mkdirSync(extractDir, { recursive: true });
    const rootPrefix = extractDir + path.sep;
    for (const entry of parsed.entries) {
      const target = path.join(extractDir, entry.name);
      // The name checks above should make this unreachable. It is here because
      // "should" is not a control when the input is hostile and the cost of
      // being wrong is a write outside the sandbox.
      if (target !== extractDir && !target.startsWith(rootPrefix)) {
        return fail("unsafe-entry", `archive entry escapes the extraction directory: ${safeName(entry.name)}`);
      }
      if (entry.kind === "dir") {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, tar.subarray(entry.dataStart, entry.dataStart + entry.size));
    }
  } catch (err) {
    return report(err, "write");
  }

  // --- 4. second line of defence -------------------------------------------
  // Nothing above can create a symlink — only regular files and directories are
  // written — so this should always find nothing. It stays because it is cheap
  // and it is the check that would catch a bug in the writer itself.
  const offenders = purgeNonRegular(extractDir);
  if (offenders.length > 0) {
    return fail(
      "unsafe-entry",
      `unpacking produced ${offenders.length} non-regular file(s): ${offenders.slice(0, 3).map(safeName).join(", ")}`,
    );
  }

  return {
    ok: true,
    runRoot: resolveRunRoot(extractDir, args.runId),
    entries: parsed.entries.length,
    uncompressedBytes: parsed.bytes,
  };
}

/**
 * Deletes anything that is not a regular file or a directory, returning what it
 * removed. `lstat`, never `stat`: the point is to see the symlink rather than
 * whatever it points at.
 */
function purgeNonRegular(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = lstatSync(full);
    if (st.isDirectory()) {
      purgeNonRegular(full, found);
    } else if (!st.isFile()) {
      found.push(entry);
      rmSync(full, { force: true });
    }
  }
  return found;
}

/**
 * Where the run tree starts: the declared run id when there is one (already
 * validated as a plain name), otherwise the archive's single top-level
 * directory, otherwise the extraction root itself.
 */
function resolveRunRoot(extractDir: string, runId?: string | null): string {
  if (runId) return path.join(extractDir, runId);
  const top = readdirSync(extractDir);
  return top.length === 1 ? path.join(extractDir, top[0]!) : extractDir;
}

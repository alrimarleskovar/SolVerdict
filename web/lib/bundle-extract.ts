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
 * MEASURED, NOT ASSUMED (GNU tar 1.35):
 *   - `../` members     tar refuses      ("Member name contains '..'")
 *   - absolute members  tar strips the leading `/`
 *   - writing THROUGH an extracted symlink   tar refuses
 *   - 200 MB of zeros compresses 1029:1, so a 64 MB upload expands to ~64 GB
 *   - 20 000 empty entries compress to 204 KB, so 64 MB carries ~6 M entries
 *
 * So traversal is already handled by tar; size, entry count, entry TYPE and
 * time are not, and are handled here. Symlinks deserve a note: tar will not
 * write through one, but it does CREATE it, and the readers downstream use
 * `readFileSync`, which follows it — `ctx.json -> /etc/passwd` would be read
 * and fed to JSON.parse. They are rejected at scan time for that reason.
 *
 * THE ORDER MATTERS. The listing pass (`tar -tzv`) decompresses the stream but
 * writes nothing to disk, so a bomb costs CPU and is bounded by the timeout;
 * only an archive that has already passed every limit is extracted.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * A run id becomes a path segment twice over (the extraction root, and the
 * stored archive's filename), so it is restricted to characters that cannot
 * mean anything to a filesystem. Real ids look like `2026-08-10T115124Z`.
 */
export const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export interface ExtractLimits {
  /** Total uncompressed bytes across all members. */
  maxUncompressedBytes: number;
  maxEntries: number;
  /** Wall clock for EACH tar invocation (listing, then extraction). */
  timeoutMs: number;
}

/**
 * 256 MB is ~500x the largest real bundle (a full N=20 run measures in the low
 * megabytes) and small enough that the extraction volume survives it. 50 000
 * entries is ~5x a full run's file count. Both are ceilings on abuse, not
 * targets — an honest bundle is nowhere near either.
 */
export const DEFAULT_LIMITS: ExtractLimits = {
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxEntries: 50_000,
  timeoutMs: 30_000,
};

export type ExtractFailure =
  | "bad-run-id"
  | "too-large"
  | "too-many-entries"
  | "unsafe-entry"
  /** The archive is unreadable — a client problem. */
  | "extract-failed"
  /**
   * WE could not run the unpacker: the binary is missing, unrunnable, or the
   * host refused. Nothing is wrong with the customer's file, and telling them
   * to re-upload it would send them chasing a fault they cannot fix.
   */
  | "server-fault";

export type ExtractResult =
  | { ok: true; runRoot: string; entries: number; uncompressedBytes: number }
  | { ok: false; reason: ExtractFailure; detail: string };

/** Entry names are attacker-supplied; render them printable and short. */
const safeName = (s: string): string => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 120);

const fail = (reason: ExtractFailure, detail: string): ExtractResult => ({ ok: false, reason, detail });

/**
 * One line of `tar -tzv`:
 *   `-rw-r--r-- owner/group  1234 2026-08-10 13:19 path/to/file`
 * The size column sits before the name, so a name containing spaces is safe to
 * capture greedily. The leading character is the entry type — `-` regular,
 * `d` directory, `l` symlink, `h` hardlink, `p` fifo, `c`/`b` device, `s`
 * socket. Anything unparseable is treated as hostile rather than skipped.
 */
const LISTING = /^(.)\S*\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.*)$/;

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

  // --- 1. listing pass: nothing touches disk yet ----------------------------
  let listing: string;
  try {
    listing = execFileSync("tar", ["-tzvf", args.archivePath], {
      timeout: limits.timeoutMs,
      // Big enough for a legitimate listing, small enough that an archive with
      // millions of members fails here rather than being counted one by one.
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Includes the bomb case: an archive too large to finish listing inside the
    // timeout never reaches extraction. Also the case where `tar` itself cannot
    // be run, which must NOT be reported as a bad upload.
    return reportExecFailure(err, "listing");
  }

  let entries = 0;
  let uncompressedBytes = 0;
  for (const raw of listing.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") continue;
    const m = LISTING.exec(line);
    if (!m) return fail("unsafe-entry", "archive listing contains an entry this server cannot parse");

    const [, type, size, name] = m;
    if (type !== "-" && type !== "d") {
      return fail(
        "unsafe-entry",
        `archive contains a ${describeType(type!)} (${safeName(name!)}) — only regular files and directories are accepted`,
      );
    }
    // Belt and braces over tar's own refusal, and it costs nothing.
    if (name!.startsWith("/") || name!.split("/").includes("..")) {
      return fail("unsafe-entry", `archive entry escapes the extraction directory: ${safeName(name!)}`);
    }

    entries++;
    if (entries > limits.maxEntries) {
      return fail("too-many-entries", `archive holds more than ${limits.maxEntries} entries`);
    }
    uncompressedBytes += Number(size);
    if (uncompressedBytes > limits.maxUncompressedBytes) {
      return fail(
        "too-large",
        `archive expands to more than ${Math.round(limits.maxUncompressedBytes / 1024 / 1024)} MB`,
      );
    }
  }

  // --- 2. extraction --------------------------------------------------------
  const extractDir = path.join(args.workDir, "extract");
  try {
    mkdirSync(extractDir, { recursive: true });
    execFileSync(
      "tar",
      ["-xzf", args.archivePath, "-C", extractDir, "--no-same-owner", "--no-same-permissions"],
      { timeout: limits.timeoutMs, maxBuffer: 1 << 20, stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    return reportExecFailure(err, "extraction");
  }

  // --- 3. second line of defence -------------------------------------------
  // The listing pass should have made this impossible. If it did not — a tar
  // build that reports a type this parser reads differently, say — the offender
  // is removed AND the bundle refused, because a disagreement between the scan
  // and the disk means the scan cannot be trusted for the rest of it either.
  const offenders = purgeNonRegular(extractDir);
  if (offenders.length > 0) {
    return fail(
      "unsafe-entry",
      `archive produced ${offenders.length} non-regular file(s) the listing did not declare: ${offenders
        .slice(0, 3)
        .map(safeName)
        .join(", ")}`,
    );
  }

  return { ok: true, runRoot: resolveRunRoot(extractDir, args.runId), entries, uncompressedBytes };
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

function describeType(type: string): string {
  return (
    { l: "symlink", h: "hard link", p: "named pipe", c: "character device", b: "block device", s: "socket" }[type] ??
    `'${safeName(type)}' entry`
  );
}

/**
 * Spawn-level errnos: the process never ran. These are the host's problem, not
 * the archive's — a missing or unrunnable `tar` looks identical to a corrupt
 * upload if you only report "could not be opened", which is exactly how a
 * server-side fault got reported to a customer as "don't recompress it".
 */
const SPAWN_ERRNOS = new Set(["ENOENT", "EACCES", "EPERM", "ENOEXEC", "ENOMEM", "EMFILE", "ENFILE", "EAGAIN"]);

interface ExecFault {
  /** True when the unpacker could not be run at all. */
  serverFault: boolean;
  /** Short, safe, and specific enough to act on. */
  detail: string;
}

/**
 * Turns an execFileSync throw into something diagnosable.
 *
 * Reports code/errno/status/signal and a truncated stderr. tar's stderr quotes
 * member NAMES, never member CONTENT, and it is sanitised to printable ASCII
 * and capped — so this cannot become a channel for reading files back out of a
 * bundle, which a naive `String(err)` would risk.
 */
function classifyExecError(err: unknown, phase: "listing" | "extraction"): ExecFault {
  const e = err as {
    code?: string | number;
    errno?: number;
    status?: number | null;
    signal?: string | null;
    killed?: boolean;
    syscall?: string;
    stderr?: Buffer | string;
  };

  const bits: string[] = [`phase=${phase}`];
  if (e?.code !== undefined) bits.push(`code=${safeName(String(e.code))}`);
  if (typeof e?.errno === "number") bits.push(`errno=${e.errno}`);
  if (typeof e?.status === "number") bits.push(`status=${e.status}`);
  if (e?.signal) bits.push(`signal=${safeName(String(e.signal))}`);
  if (e?.syscall) bits.push(`syscall=${safeName(String(e.syscall))}`);
  const stderr = safeName(String(e?.stderr ?? "").replace(/\s+/g, " ").trim()).slice(0, 240);
  if (stderr) bits.push(`stderr="${stderr}"`);

  // ORDER MATTERS. A timeout also arrives with `syscall=spawnSync tar`, so the
  // spawn-failure test below would claim it as ours — when a slow unpack is
  // almost always the archive's doing (a bomb). Timeouts are classified first.
  if (e?.killed || e?.signal === "SIGTERM" || e?.code === "ETIMEDOUT") {
    return { serverFault: false, detail: `archive timed out while being read (${bits.join(" ")})` };
  }
  if (e?.code === "ENOBUFS") {
    return { serverFault: false, detail: `archive listing is too large to read (${bits.join(" ")})` };
  }

  const spawnFailed =
    (typeof e?.code === "string" && SPAWN_ERRNOS.has(e.code)) ||
    (typeof e?.syscall === "string" && e.syscall.startsWith("spawnSync"));

  if (spawnFailed) {
    return {
      serverFault: true,
      detail: `the server could not run its unpacker (${bits.join(" ")}) — this is a fault on our side, not with your bundle`,
    };
  }
  return { serverFault: false, detail: `not a readable gzip archive (${bits.join(" ")})` };
}

/**
 * Every unpacker failure goes to the log as well as to the caller. The response
 * is seen by one customer; the log is how a systematic fault — the binary
 * missing on a whole deploy, say — becomes visible at all.
 */
function reportExecFailure(err: unknown, phase: "listing" | "extraction"): ExtractResult {
  const fault = classifyExecError(err, phase);
  console.error(`[bundle-extract] tar ${phase} failed — ${fault.detail}`);
  return fail(fault.serverFault ? "server-fault" : "extract-failed", fault.detail);
}

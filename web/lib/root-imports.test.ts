// SPDX-License-Identifier: Apache-2.0
/**
 * BUILD GUARD: every dependency the web build reaches ABOVE /web must be
 * installed in /web.
 *
 * WHY THIS EXISTS. The web app compiles TypeScript from the repo root
 * (`experimental.externalDir`), but the root and /web are two independent npm
 * installs — this is not a workspace. Vercel's Root Directory is /web, so it
 * clones the whole repo and installs only /web. A root module that imports a
 * bare package therefore resolves fine on a developer machine (the root install
 * is right there) and fails on Vercel with "Module not found" pointing at a
 * file outside the app. That is exactly how the deploy broke:
 * lib/evidence-intake.ts reached issuance/derive.ts, which needs
 * @solana/web3.js and bs58.
 *
 * next.config.mjs now adds web/node_modules as a resolution fallback, which
 * makes those two resolve. This test is the other half: it fails LOCALLY the
 * moment the web build reaches a root dependency /web does not declare, instead
 * of that surfacing as a red deploy twenty minutes later.
 *
 * WHY THE FILESYSTEM CHECK IS HERE. The same assumption broke production a
 * second time, at runtime: the intake route hashed the pre-registration
 * document off the repo root, which a serverless bundle does not contain, so
 * every submission answered "server cannot read its own prereg document". A
 * module reachable from the web build may only read paths it was HANDED at
 * runtime (an extracted bundle in a temp dir), never a file that happens to sit
 * in the repository. Each fs-reading module above /web must be listed below
 * with the reason it is safe.
 *
 * WHY THE NUL CHECK IS HERE. issuance/derive.ts contained a literal NUL byte in
 * a template literal. file(1) called it `data`, and grep silently skipped it —
 * a dependency audit of the very file that was breaking the build came back
 * clean. Any scan of this codebase is only as trustworthy as its willingness to
 * read every byte, so this asserts the sources stay text.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ROOT = path.resolve(WEB, "..");
const APP = path.join(WEB, "app");

/**
 * Modules ABOVE /web that touch the filesystem and are allowed to, because the
 * paths they read are handed to them at runtime rather than assumed to exist in
 * a repository.
 */
const FS_READERS_ALLOWED: Record<string, string> = {
  "issuance/verify.ts": "reads the extracted bundle under a per-request temp dir",
  "scoring/rescore.ts": "reads the extracted bundle under a per-request temp dir",
};

/**
 * Modules that read a REPOSITORY file. Reachable from the web build means
 * broken on Vercel, where the bundle ships no repository.
 */
const REPO_FILE_READERS: Record<string, string> = {
  "lib/prereg.ts":
    "hashes tripwire-prereg-*.md off disk — the request path must use the PREREG.sha256 literal instead",
  "lib/evidence.ts": "packages evidence from runs/ — bench-side only",
};

const FS_READ = /\b(readFileSync|readdirSync|statSync|lstatSync|existsSync|createReadStream|opendirSync)\s*\(/;

const deps = new Set(
  Object.keys(
    (JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8")) as { dependencies?: Record<string, string> })
      .dependencies ?? {},
  ),
);

/** Comments stripped so a commented-out import cannot trip or hide anything. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Mirrors next.config.mjs's extensionAlias: `./x.js` may mean `./x.ts`. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const raw = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    raw,
    raw.replace(/\.js$/, ".ts"),
    raw.replace(/\.js$/, ".tsx"),
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    path.join(raw, "index.ts"),
    path.join(raw, "index.tsx"),
  ];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const SOURCE = /\.(ts|tsx)$/;

/** All `from "…"` / `import "…"` specifiers, with type-only forms marked. */
function specifiers(src: string): Array<{ spec: string; typeOnly: boolean }> {
  const out: Array<{ spec: string; typeOnly: boolean }> = [];
  const code = stripComments(src);
  for (const m of code.matchAll(/(?:^|[\s;}])(import|export)\s+(type\s+)?([^;]*?)from\s*["']([^"']+)["']/g)) {
    out.push({ spec: m[4]!, typeOnly: Boolean(m[2]) });
  }
  for (const m of code.matchAll(/(?:^|[\s;}])import\s*["']([^"']+)["']/g)) {
    out.push({ spec: m[1]!, typeOnly: false });
  }
  return out;
}

// --- walk the build graph from Next's entry points --------------------------
// Entry points are app/** only. web/worker/** is a separate Node process built
// from the root Dockerfile (which DOES install the root), so it is correctly
// out of scope here.
function entryPoints(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) entryPoints(p, out);
    else if (SOURCE.test(p)) out.push(p);
  }
  return out;
}

const seen = new Set<string>();
const queue = entryPoints(APP);
for (const f of queue) seen.add(f);

/** Bare specifiers required by modules that live ABOVE /web. */
const rootDeps = new Map<string, string[]>(); // package → root files needing it
const rootModules: string[] = [];
const nulFiles: string[] = [];
const repoReaders: string[] = [];
const unlistedFsReaders: string[] = [];

while (queue.length) {
  const file = queue.shift()!;

  const bytes = readFileSync(file);
  if (bytes.includes(0)) nulFiles.push(path.relative(ROOT, file));
  const src = bytes.toString("utf8");

  const outsideWeb = !file.startsWith(WEB + path.sep);
  if (outsideWeb) {
    const rel = path.relative(ROOT, file);
    rootModules.push(rel);
    if (rel in REPO_FILE_READERS) repoReaders.push(rel);
    else if (FS_READ.test(stripComments(src)) && !(rel in FS_READERS_ALLOWED)) unlistedFsReaders.push(rel);
  }

  for (const { spec, typeOnly } of specifiers(src)) {
    if (spec.startsWith(".")) {
      const dep = resolveRelative(file, spec);
      // A .json import resolves but is not a module to walk.
      if (dep && SOURCE.test(dep) && !seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
      continue;
    }
    if (spec.startsWith("node:")) continue;
    // A type-only import is erased before webpack sees it, so it needs no
    // installed package. Runtime imports are what break a build.
    if (typeOnly) continue;
    if (!outsideWeb) continue; // /web resolves its own deps normally

    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
    const needers = rootDeps.get(pkg) ?? [];
    needers.push(path.relative(ROOT, file));
    rootDeps.set(pkg, needers);
  }
}

// --- anti-vacuity: a broken walk must not pass by finding nothing -----------
assert.ok(seen.size > 60, `only ${seen.size} modules walked — the resolver is broken, not the graph clean`);
assert.ok(
  rootModules.length > 5,
  `the web build reached only ${rootModules.length} module(s) above /web — externalDir usage should be visible here`,
);

// --- the invariant -----------------------------------------------------------
const missing = [...rootDeps.entries()].filter(([pkg]) => !deps.has(pkg));
assert.deepEqual(
  missing.map(([pkg]) => pkg),
  [],
  "root modules in the web build require packages web/package.json does not declare:\n" +
    missing.map(([pkg, files]) => `  ${pkg}  ← ${[...new Set(files)].join(", ")}`).join("\n") +
    "\nAdd them to web/package.json (they must be installed where Vercel installs).",
);

// --- nothing in the request path may assume a repository ---------------------
assert.deepEqual(
  repoReaders,
  [],
  "the web build reaches module(s) that read a REPOSITORY file at runtime:\n" +
    repoReaders.map((m) => `  ${m} — ${REPO_FILE_READERS[m]}`).join("\n") +
    "\nVercel ships no repository; this fails at request time, not build time.",
);
assert.deepEqual(
  unlistedFsReaders,
  [],
  "module(s) above /web touch the filesystem and are not listed as safe:\n" +
    unlistedFsReaders.map((m) => `  ${m}`).join("\n") +
    "\nAdd to FS_READERS_ALLOWED with the reason the path is runtime-supplied, or stop reading files.",
);

// --- sources must be readable by every tool ---------------------------------
assert.deepEqual(
  nulFiles,
  [],
  `source files containing a NUL byte (grep and file(1) treat these as binary and skip them silently):\n  ${nulFiles.join("\n  ")}`,
);

console.log(
  `root-imports guard passed (${seen.size} modules in the web build, ${rootModules.length} above /web, ` +
    `${rootDeps.size} root dependency/ies: ${[...rootDeps.keys()].sort().join(", ") || "none"}, ` +
    `no repo-file readers)`,
);

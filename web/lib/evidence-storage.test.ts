// SPDX-License-Identifier: Apache-2.0
/**
 * Two properties, both enforced statically because both failed in production
 * without any test noticing.
 *
 * 1. NO DEPLOYED PATH MAY USE THE FILESYSTEM STORE. Intake wrote the bundle to
 *    Vercel's /tmp and stored the absolute path in `evidence_ref`; the worker,
 *    on Railway, opened that path on a different machine and got ENOENT. The
 *    local store is correct only when writer and reader are one process, which
 *    is true of the proofs and of nothing that ships. A unit test cannot catch
 *    this — both halves work in isolation — so the check is "is it wired in".
 *
 * 2. THE BUNDLE IS NEVER PUBLICLY ADDRESSABLE. A bundle is the customer's run:
 *    their agent's transactions, their task text, their instance. SECURITY.md's
 *    rule for tables is every access server-side through `supabaseAdmin()`, no
 *    untrusted client ever holding a credential. The object store inherits it,
 *    which means the bytes are read server-side and never turned into a URL —
 *    not a public one, and not a signed one either.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { EVIDENCE_BUCKET, isLegacyLocalRef, supabaseEvidenceStore } from "./evidence-storage";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** Every source file that runs in a deployment: routes, worker, shared lib. */
function deployedSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "scripts") continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) deployedSources(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const sources = [
  ...deployedSources(path.join(WEB, "app")),
  ...deployedSources(path.join(WEB, "worker")),
  ...deployedSources(path.join(WEB, "lib")),
];
assert.ok(sources.length > 40, `only ${sources.length} sources scanned — the walk is broken, not the code clean`);

// --- 1. the filesystem store is dev-only -------------------------------------
{
  const wired = sources.filter((f) => {
    // Its own definition and the storage module's doc comments do not count.
    if (f.endsWith(path.join("lib", "evidence-intake.ts"))) return false;
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return src.includes("localEvidenceStore");
  });
  assert.deepEqual(
    wired.map((f) => path.relative(WEB, f)),
    [],
    "a deployed path wires the FILESYSTEM evidence store:\n" +
      wired.map((f) => `  ${path.relative(WEB, f)}`).join("\n") +
      "\nIntake and the worker run on different hosts; a path is not a reference.",
  );
}

// --- 2. nothing mints a URL for a bundle -------------------------------------
{
  const leaks: string[] = [];
  for (const f of sources) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const api of ["getPublicUrl", "createSignedUrl", "createSignedUrls"]) {
      if (src.includes(api)) leaks.push(`${path.relative(WEB, f)} -> ${api}`);
    }
  }
  assert.deepEqual(
    leaks,
    [],
    "evidence must never become an addressable URL:\n" + leaks.map((l) => `  ${l}`).join("\n"),
  );
}

// --- 3. a reference from the retired store fails legibly ---------------------
{
  assert.equal(isLegacyLocalRef("/tmp/solverdict-evidence/abc/2026.tar.gz"), true);
  assert.equal(isLegacyLocalRef("032bb0dc-f0ae-4834-8fcc-76380d7c7ebd/2026.tar.gz"), false);

  // The row that broke: an absolute path to a serverless disk that is gone. The
  // worker must say THAT, not "object not found" — the operator needs to know
  // the bundle is unrecoverable and the audit has to be resubmitted.
  // Deferred to main() below: this file is CommonJS under tsx, so there is no
  // top-level await, and a floating promise would let the suite print "passed"
  // before the assertion ran.
}

// --- 4. the bucket name is fixed and private by construction -----------------
{
  assert.equal(EVIDENCE_BUCKET, "audit-evidence");
  const migration = readFileSync(path.join(WEB, "supabase/migrations/008_evidence_storage.sql"), "utf8");

  // Assert on the INSERT's value tuple specifically. An earlier version of this
  // check searched the whole file for "false", which the explanatory comments
  // satisfy — it passed with the bucket flipped to public. A privacy control
  // that cannot fail is not a control.
  const insert = /insert\s+into\s+storage\.buckets[\s\S]*?values\s*\(([^)]*)\)/i.exec(migration);
  assert.ok(insert, "the migration must create the bucket");
  assert.match(insert![1]!, /,\s*false\s*$/i, "the bucket must be created with public => false");
  assert.ok(!/\btrue\b/i.test(insert![1]!), "the bucket insert must not pass true for public");
  assert.ok(!/set\s+public\s*=\s*true/i.test(migration), "the migration must never flip the bucket public");
}

const main = async () => {
  // The row that broke: an absolute path to a serverless disk that is gone. The
  // worker must say THAT, not "object not found" — the operator needs to know
  // the bundle is unrecoverable and the audit has to be resubmitted.
  await assert.rejects(
    () => supabaseEvidenceStore().get("/tmp/solverdict-evidence/032bb0dc/2026-08-10T150633Z.tar.gz"),
    /retired local store|resubmitted/,
    "a legacy path must fail with the reason, not as a missing object",
  );
  console.log("evidence-storage guard passed (no filesystem store deployed, no URLs minted, bucket private)");
};

void main();

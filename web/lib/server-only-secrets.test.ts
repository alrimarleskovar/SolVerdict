// SPDX-License-Identifier: Apache-2.0
/**
 * GUARD: the service-role key must never reach the browser (finding #11).
 *
 * WHY THIS IS LOAD-BEARING. Row Level Security is currently DISABLED on the
 * Supabase tables. That is safe only because every database access happens
 * server-side through `supabaseAdmin()`, which holds the service_role key and
 * bypasses RLS by design. The entire access-control story therefore rests on
 * one invariant: no client bundle may ever contain that key.
 *
 * Two ways to break it, both silent:
 *   1. a "use client" module imports lib/supabase — directly, or through a
 *      chain of relative imports — and Next inlines the key into the bundle;
 *   2. someone renames the env var with a NEXT_PUBLIC_ prefix, which Next
 *      substitutes into client code by definition.
 *
 * Neither produces an error. The app keeps working, and the key is public.
 *
 * SUBTLETY: the directive is detected as a real leading directive, not as the
 * string "use client" appearing anywhere. lib/supabase.ts documents the rule in
 * a comment and must not be flagged for saying so.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SUPABASE_MODULE = path.join(WEB, "lib/supabase.ts");
const RULECHECK_KEY_MODULE = path.join(WEB, "lib/rulecheck-key.ts");

/**
 * Modules that hold a secret and must therefore stay out of every client
 * bundle.
 *
 * lib/supabase.ts holds the service-role key. lib/rulecheck-key.ts holds the
 * record signing seed — the one secret whose leak lets someone else sign
 * records in this project's name (RULECHECK.md §7, rulecheck/keys.ts). It moves
 * no money and cannot make a wrong record right, since what a rule says about
 * bytes is recomputable without any key; what it can do is put this project's
 * name on a record it never issued.
 */
const SERVER_ONLY = [SUPABASE_MODULE, RULECHECK_KEY_MODULE];
const SKIP = new Set(["node_modules", ".next", "supabase", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(WEB);
assert.ok(files.length > 40, `only ${files.length} files scanned — the walk is broken, not the app clean`);

/** Source with comments stripped, so a comment can neither hide nor fake code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * True when the file opens with the "use client" DIRECTIVE — i.e. it is the
 * first statement, ahead of any import. Merely mentioning the string (as this
 * file and lib/supabase.ts both do) is not the directive.
 */
function isClientModule(src: string): boolean {
  const first = code(src)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return first === '"use client";' || first === "'use client';" || first === '"use client"' || first === "'use client'";
}

/** Relative import specifiers, resolved to files on disk. */
function relativeImports(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of code(src).matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    const raw = path.resolve(path.dirname(file), m[1]);
    for (const cand of [raw, `${raw}.ts`, `${raw}.tsx`, path.join(raw, "index.ts"), path.join(raw, "index.tsx")]) {
      if (existsSync(cand) && statSync(cand).isFile()) {
        out.push(cand);
        break;
      }
    }
  }
  return out;
}

const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const clientEntries = files.filter((f) => isClientModule(source.get(f)!));

// Sanity: the app really does have client components, so a broken detector
// cannot make this suite pass by finding nothing to check.
assert.ok(clientEntries.length > 5, `only ${clientEntries.length} client modules detected — the detector is broken`);
assert.ok(!isClientModule(source.get(SUPABASE_MODULE)!), "lib/supabase.ts must not be a client module");

// --- 1. no client module reaches lib/supabase, directly or transitively -----
{
  const violations: string[] = [];
  for (const entry of clientEntries) {
    // BFS the relative-import graph; a package import cannot reach lib/supabase.
    const seen = new Set<string>([entry]);
    const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
    while (queue.length) {
      const { file, chain } = queue.shift()!;
      for (const dep of relativeImports(file, source.get(file) ?? readFileSync(file, "utf8"))) {
        if (SERVER_ONLY.includes(dep)) {
          violations.push([...chain, dep].map((p) => path.relative(WEB, p)).join("\n      → "));
          continue;
        }
        if (seen.has(dep) || !source.has(dep)) continue;
        seen.add(dep);
        queue.push({ file: dep, chain: [...chain, dep] });
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `a "use client" module reaches a server-only secret holder, so its secret would be inlined into the browser ` +
      `bundle: lib/supabase.ts means the SUPABASE_SERVICE_ROLE_KEY, and RLS is off, so that key is full ` +
      `read/write on every table; lib/rulecheck-key.ts means the record signing seed.\n\n  ${violations.join("\n\n  ")}\n\n` +
      `Move the access to a route handler or server component and have the client fetch it.`,
  );
}

// --- 2. the service-role key is never exposed through NEXT_PUBLIC_ ----------
{
  const offenders: string[] = [];
  const scan = (label: string, text: string) => {
    // SEED and SIGNING are here because the record signing seed would not have
    // matched any of the first four names, and a secret is only as protected as
    // the pattern that looks for it.
    for (const m of text.matchAll(
      /NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SERVICE_KEY|SECRET|PRIVATE|SEED|SIGNING)[A-Z0-9_]*/g,
    )) {
      offenders.push(`${label}: ${m[0]}`);
    }
  };
  for (const f of files) scan(path.relative(WEB, f), source.get(f)!);
  for (const env of [path.join(WEB, ".env.example"), path.join(WEB, "..", ".env.example")]) {
    if (existsSync(env)) scan(path.relative(path.join(WEB, ".."), env), readFileSync(env, "utf8"));
  }
  assert.deepEqual(
    offenders,
    [],
    `NEXT_PUBLIC_ is substituted into client bundles by definition, so a secret must never carry that ` +
      `prefix:\n  ${offenders.join("\n  ")}`,
  );
}

// --- 3. the key is read in exactly one place --------------------------------
{
  const readers = files
    .filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(code(source.get(f)!)))
    .map((f) => path.relative(WEB, f))
    .sort();
  assert.deepEqual(
    readers,
    ["lib/server-only-secrets.test.ts", "lib/supabase.ts"],
    "SUPABASE_SERVICE_ROLE_KEY must be read only by lib/supabase.ts (this guard names it too). " +
      "A second reader is a second place to get the client/server boundary wrong.",
  );
}

// --- 3b. the record signing seed is read in exactly one place ---------------
{
  const readers = files
    .filter((f) => !f.endsWith(".test.ts"))
    .filter((f) => /RULECHECK_RECORD_SIGNING_SEED/.test(code(source.get(f)!)))
    .map((f) => path.relative(WEB, f))
    .sort();
  assert.deepEqual(
    readers,
    ["lib/rulecheck-key.ts"],
    "the record signing seed must be read only by lib/rulecheck-key.ts, which checks it against the published " +
      "registry and refuses if it is also a payment-receiving key (RULECHECK.md §7). A second reader is a second " +
      "place for the seed to reach a log, a response or a bundle. Suites may name the variable; production code " +
      "may not read it twice.",
  );
}

// --- 4. .env.example documents the key, un-prefixed -------------------------
{
  // Read here rather than by hand: env files are permission-protected, and a
  // machine check is the right way to assert something about a secrets template.
  const env = path.join(WEB, ".env.example");
  assert.ok(existsSync(env), "web/.env.example must exist so a deployer knows which vars are required");
  const t = readFileSync(env, "utf8");
  // WARN, not fail: web/.env.example is currently stale in a way unrelated to
  // this guard (it predates Sprint 5 — it still lists the removed Upstash vars
  // and documents no Supabase var at all). Blocking CI on that would stop
  // unrelated work; leaving it silent would let it rot. Promote this to an
  // assertion once the template lists SUPABASE_URL / _SERVICE_ROLE_KEY / _ANON_KEY.
  if (!/^\s*#?\s*SUPABASE_SERVICE_ROLE_KEY\s*=/m.test(t)) {
    console.warn(
      "  [warn] web/.env.example does not document SUPABASE_SERVICE_ROLE_KEY. A deploy that omits it fails " +
        "closed, but a deployer who invents a NEXT_PUBLIC_ name for it does not.",
    );
  }
  assert.ok(
    !/NEXT_PUBLIC_[A-Z0-9_]*SUPABASE[A-Z0-9_]*/.test(t),
    "no Supabase credential may be exposed through a NEXT_PUBLIC_ name",
  );

  // ASSERTED, not warned, unlike the Supabase line above. That warning covers a
  // deploy that fails closed: no Supabase credential means no database and
  // nothing works, loudly, on the first request. The rulecheck signing vars fail
  // in the other direction — the surface runs, answers, and simply issues no
  // signed record, which looks like a working deployment. A variable a deployer
  // is never told about is a variable they will not set, so the template naming
  // them is the only thing standing between "not configured" and "silently
  // unsigned". Every name here is read by lib/rulecheck-key.ts.
  for (const [name, why] of [
    ["RULECHECK_RECORD_KEY_ID", "which entry of rulecheck/keys.ts this deployment signs as"],
    ["RULECHECK_RECORD_SIGNING_SEED", "the record signing key itself (32-byte Ed25519 seed, base58, SECRET)"],
  ] as const) {
    assert.ok(
      new RegExp(`^\\s*#?\\s*${name}\\s*=`, "m").test(t),
      `web/.env.example must document ${name} — ${why}. Run \`npm run rulecheck:keygen -- --key-id <id>\` for a ` +
        `seed and its registry entry. Without both variables set, this surface answers requests and issues no ` +
        `signed record, which is a deployment that looks healthy and produces nothing verifiable.`,
    );
  }
}

// --- 5. the documented rule exists and says the right thing -----------------
{
  const sec = path.join(WEB, "SECURITY.md");
  assert.ok(existsSync(sec), "web/SECURITY.md must exist — the RLS-off compensating control has to be written down");
  const t = readFileSync(sec, "utf8");
  for (const phrase of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_", "Row Level Security", "supabaseAdmin"]) {
    assert.ok(t.includes(phrase), `web/SECURITY.md must mention ${phrase}`);
  }
}

console.log(
  `server-only-secrets guard passed (${files.length} files, ${clientEntries.length} client modules, ` +
    `no path to ${SERVER_ONLY.map((m) => path.relative(WEB, m)).join(" or ")})`,
);

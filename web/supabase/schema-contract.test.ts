// SPDX-License-Identifier: Apache-2.0
/**
 * The schema contract: what the CODE queries must exist in what the INSTALL
 * PATH produces.
 *
 * The defect this exists to stop: `schema.sql` sat at its Sprint-5 shape while
 * migrations 005-010 added the `awaiting_evidence` status, `instance_seed`,
 * `issued_instance`, `evidence_ref`, `evidence_manifest` and `auth_sessions` —
 * all of them referenced by shipping code. Anyone who ran the documented
 * instruction (`psql -f schema.sql`) on this public repo got a database the
 * product cannot run against, and nothing said so.
 *
 * WHAT THIS CHECKS, AND WHAT IT CANNOT.
 *
 * It is a STATIC check: it reads the SQL as text and models what applying it
 * would create. It therefore proves that the install path MENTIONS everything
 * the code needs, and that the files are ordered and named coherently. It does
 * NOT prove the SQL executes — only a database can prove that, and a database
 * is not available in this test run. `verify-schema.sh` does that half and is
 * documented as a manual step precisely so this file is not mistaken for it.
 *
 * That division is deliberate. The failure that actually happened was a
 * MISSING OBJECT, not invalid SQL, and a missing object is exactly what a
 * static check catches. Claiming CI coverage we do not have would be the same
 * class of defect as the one being fixed.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WEB = path.resolve(HERE, "..");

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
};

const read = (p: string) => readFileSync(p, "utf8");
const baseline = read(path.join(HERE, "schema.sql"));

const migrationFiles = readdirSync(path.join(HERE, "migrations"))
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort();

/** schema.sql followed by every migration, in the order install.sh applies them. */
const applied = [baseline, ...migrationFiles.map((f) => read(path.join(HERE, "migrations", f)))].join("\n");

/** SQL with comments stripped — a mention inside a comment is not an object. */
const sqlOnly = (s: string) => s.replace(/--[^\n]*/g, "");
const appliedSql = sqlOnly(applied);

// --- the files are coherent -------------------------------------------------
t("migrations are numbered contiguously from 001 with no duplicates", () => {
  const nums = migrationFiles.map((f) => Number(f.slice(0, 3)));
  assert.ok(nums.length > 0, "no migrations found — this test would pass vacuously");
  const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
  assert.deepEqual(dupes, [], `duplicate migration numbers: ${dupes.join(", ")}`);
  nums.forEach((n, i) => {
    assert.equal(n, i + 1, `migration numbering has a gap or reorder at ${migrationFiles[i]}`);
  });
});

// --- ORDER DEPENDENCE is real, and is asserted rather than assumed ----------
t("objects redefined by more than one migration are applied last-wins, in order", () => {
  // Both of these are redefined later, which is the mechanism — not an accident.
  // If a redefinition ever moved to a LOWER number than the definition it
  // replaces, install.sh would apply the newer one first and the older one
  // would win, silently.
  const redefinitions: Record<string, string[]> = {};
  for (const f of migrationFiles) {
    const body = sqlOnly(read(path.join(HERE, "migrations", f)));
    for (const m of body.matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+)/gi)) {
      (redefinitions[`function ${m[1]}`] ??= []).push(f);
    }
    for (const m of body.matchAll(/add\s+constraint\s+([a-z_]+)/gi)) {
      (redefinitions[`constraint ${m[1]}`] ??= []).push(f);
    }
  }
  const multi = Object.entries(redefinitions).filter(([, fs]) => fs.length > 1);
  assert.ok(multi.length > 0, "expected at least one redefined object — otherwise this check is vacuous");
  for (const [obj, files] of multi) {
    const nums = files.map((f) => Number(f.slice(0, 3)));
    assert.deepEqual(
      [...nums].sort((a, b) => a - b),
      nums,
      `${obj} is redefined in ${files.join(", ")} — the winning definition must be the highest-numbered file`,
    );
  }
});

// --- what the code queries must exist --------------------------------------
/** Source files that talk to the database. */
function codeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".next") walk(p);
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) {
        out.push(p);
      }
    }
  };
  walk(path.join(WEB, "lib"));
  walk(path.join(WEB, "app"));
  walk(path.join(WEB, "worker"));
  return out;
}

const code = codeFiles().map(read).join("\n");

t("every table the code selects from exists in the applied schema", () => {
  const tables = new Set([...code.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]));
  tables.delete("x"); // a generic in a type-level helper, not a table
  assert.ok(tables.size >= 4, `expected several tables, found ${[...tables].join(", ")}`);
  for (const table of tables) {
    assert.match(
      appliedSql,
      new RegExp(`create table (if not exists )?${table}\\b`, "i"),
      `code queries table "${table}", which the install path never creates`,
    );
  }
});

t("every RPC the code calls is defined in the applied schema", () => {
  const rpcs = new Set([...code.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(rpcs.size >= 2, `expected several rpcs, found ${[...rpcs].join(", ")}`);
  for (const fn of rpcs) {
    assert.match(
      appliedSql,
      new RegExp(`create or replace function ${fn}\\b`, "i"),
      `code calls rpc "${fn}", which the install path never defines`,
    );
  }
});

t("every audit status the code writes is permitted by the final check constraint", () => {
  // The LAST audits_status_check in application order is the one in force.
  // Scoped to `check (status in (...))` so a `v_status in (...)` inside a
  // function body is not mistaken for the constraint — that local variable
  // legitimately lists a SUBSET (the statuses that mean "already submitted"),
  // and reading it as the constraint would report `failed` as forbidden.
  const checks = [...appliedSql.matchAll(/check\s*\(\s*status\s+in\s*\(([^)]*)\)/gi)];
  assert.ok(checks.length > 0, "no status check constraint found");
  const permitted = new Set(
    [...checks[checks.length - 1][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  );
  const used = new Set(
    [...code.matchAll(/"(awaiting_payment|awaiting_evidence|queued|running|done|failed|payment_failed)"/g)].map(
      (m) => m[1],
    ),
  );
  assert.ok(used.has("awaiting_evidence"), "expected the evidence flow to be in use — otherwise this check is vacuous");
  for (const status of used) {
    assert.ok(
      permitted.has(status),
      `code writes status "${status}", which the applied check constraint rejects (permits: ${[...permitted].join(", ")})`,
    );
  }
});

t("every audits column the code depends on is added somewhere in the install path", () => {
  // Named explicitly rather than parsed out of the code: these are the columns
  // migrations 005-010 introduced, and they are the exact set that was missing.
  for (const col of ["instance_seed", "issued_instance", "evidence_ref", "evidence_manifest", "public_opt_in"]) {
    assert.ok(
      new RegExp(`\\b${col}\\b`).test(code),
      `${col} is no longer referenced by any code — remove it from this list rather than leaving a vacuous assertion`,
    );
    assert.match(
      appliedSql,
      new RegExp(`(add column (if not exists )?${col}|^\\s*${col}\\s+\\w)`, "im"),
      `code reads audits.${col}, which the install path never creates`,
    );
  }
});

// --- the install instruction is singular and correct ------------------------
t("the baseline declares itself a baseline and points at the one install path", () => {
  assert.match(baseline, /BOOTSTRAP BASELINE/, "schema.sql must say what it is");
  assert.match(baseline, /install\.sh/, "schema.sql must name the install path");
  assert.ok(
    /Applying this file ALONE produces a database the product cannot run against/.test(baseline),
    "schema.sql must state the consequence of applying it alone",
  );
});

t("no document tells anyone to apply schema.sql on its own", () => {
  const docs = [
    path.join(WEB, "supabase", "schema.sql"),
    path.join(WEB, "supabase", "README.md"),
    path.join(WEB, "README.md"),
    path.resolve(WEB, "..", "README.md"),
    path.resolve(WEB, "..", "docs", "QUICKSTART.md"),
  ].filter(existsSync);
  for (const d of docs) {
    const text = read(d);
    // A bare `psql ... -f .../schema.sql` with no migrations following is the
    // instruction that produced the broken database.
    const bad = [...text.matchAll(/psql[^\n]*schema\.sql/g)].filter((m) => !/install\.sh/.test(m[0]));
    assert.deepEqual(
      bad.map((m) => m[0]),
      [],
      `${path.relative(path.resolve(WEB, ".."), d)} still tells the reader to apply schema.sql directly`,
    );
  }
});

t("install.sh applies the baseline first and then migrations in sorted order", () => {
  const sh = read(path.join(HERE, "install.sh"));
  assert.match(sh, /schema\.sql/, "install.sh must apply the baseline");
  assert.match(sh, /sort/, "install.sh must order the migrations");
  assert.match(sh, /ON_ERROR_STOP=1/, "a partial apply is the state that must not be reachable");
  assert.match(sh, /-1\b/, "the whole install must be one transaction");
});

console.log(`schema contract tests passed (${passed} cases, ${migrationFiles.length} migrations)`);

// SPDX-License-Identifier: Apache-2.0
/**
 * Prereg self-certification tests (audit D3).
 *
 * The point of D3 was that three hardcoded stamps said v0.2.2 while the harness
 * ran the v0.3.0 rubric. These tests make that class of drift a test failure
 * rather than something noticed after an official run is published.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PREREG } from "../config/prereg.js";
import { certifyPrereg } from "./prereg.js";
import { BRANDING } from "../config/branding.js";
import { SCENARIOS, CATEGORY_NAMES } from "../scenarios/index.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// --- the declared prereg document exists ---------------------------------
{
  assert.ok(
    existsSync(path.join(ROOT, PREREG.file)),
    `config/prereg.ts names ${PREREG.file}, which is not at the repo root`,
  );
  assert.match(PREREG.file, /^tripwire-prereg-v\d+\.\d+\.\d+\.md$/);
  assert.match(PREREG.version, /^v\d+\.\d+\.\d+$/);
  // The filename and the version string must agree — the exact pairing that
  // drifted (file v0.2.2 / rubric v0.3.0).
  assert.ok(
    PREREG.file.includes(PREREG.version),
    `prereg file "${PREREG.file}" does not carry version "${PREREG.version}"`,
  );
}

// --- the declared shape matches the code that implements it --------------
{
  assert.equal(
    SCENARIOS.length,
    PREREG.scenarios,
    `config/prereg.ts declares ${PREREG.scenarios} scenarios; scenarios/index.ts registers ${SCENARIOS.length}`,
  );
  assert.equal(
    Object.keys(CATEGORY_NAMES).length,
    PREREG.categories,
    `config/prereg.ts declares ${PREREG.categories} categories; CATEGORY_NAMES has ${Object.keys(CATEGORY_NAMES).length}`,
  );
  const categoriesInUse = new Set(SCENARIOS.map((s) => s.category));
  assert.equal(categoriesInUse.size, PREREG.categories, "every declared category has at least one scenario");
}

// --- every published stamp reads from the single source ------------------
{
  assert.equal(BRANDING.preregFile, PREREG.file, "branding must not carry its own copy of the filename");
  assert.match(
    BRANDING.description,
    new RegExp(`${PREREG.scenarios} adversarial scenarios, ${PREREG.categories} categories`),
    "the published description must state the current rubric size",
  );
}

// --- certification hashes the real bytes ---------------------------------
{
  const cert = certifyPrereg(ROOT);
  assert.equal(cert.file, PREREG.file);
  assert.equal(cert.version, PREREG.version);
  assert.equal(cert.error, undefined);
  assert.ok(cert.bytes && cert.bytes > 0);

  const expected =
    "sha256:" + createHash("sha256").update(readFileSync(path.join(ROOT, PREREG.file))).digest("hex");
  assert.equal(cert.sha256, expected, "the digest must be over the document's exact bytes");
  assert.match(cert.sha256!, /^sha256:[0-9a-f]{64}$/);
}

// --- an unreadable document is reported, never fabricated ----------------
{
  const cert = certifyPrereg(path.join(ROOT, "does-not-exist"));
  assert.equal(cert.sha256, null, "a missing prereg yields no digest…");
  assert.ok(cert.error, "…and says why");
  assert.equal(cert.file, PREREG.file, "while still naming what it looked for");
}

console.log("prereg tests passed");

// SPDX-License-Identifier: Apache-2.0
/**
 * The serverless function has no repository. Prove the request path does not
 * need one.
 *
 * THIRD TIME. A root-file assumption has now broken production twice — once at
 * BUILD time (`../issuance/derive.ts` resolving `@solana/web3.js` from a root
 * node_modules Vercel never installs) and once at RUN time (`certifyPrereg`
 * hashing `tripwire-prereg-v0.3.0.md` off a repo root the bundle does not
 * contain, so every submission died on "server cannot read its own prereg
 * document"). Both were invisible locally, because locally the repository is
 * always right there.
 *
 * So this test removes the repository from the equation: it runs the real
 * production ports from a working directory with nothing above it, which is the
 * condition Vercel actually runs under. Anything that reaches for a repo file
 * fails here instead of on a customer's submission.
 *
 * The guarantee the old code was buying — "the digest is the real document's" —
 * is not dropped, it moves: config/prereg.ts pins the literal, and
 * lib/prereg.test.ts asserts that literal equals `certifyPrereg()` on every CI
 * run, where the document does exist. A drifted literal fails CI; it cannot
 * silently accept a bundle from a different methodology.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { productionPorts } from "../app/api/audit/[id]/evidence/route";
import { PREREG } from "../../config/prereg";

const original = process.cwd();
// `/tmp/xxx` has no repository above it — no package.json, no
// tripwire-prereg-*.md, no node_modules. Same as a serverless bundle.
const nowhere = mkdtempSync(path.join(tmpdir(), "no-repo-"));

try {
  process.chdir(nowhere);

  const ports = productionPorts();

  // The methodology check must have a digest without touching a filesystem.
  assert.equal(
    typeof ports.preregSha256,
    "string",
    "preregSha256 must be a value; a function invites reading it off disk again",
  );
  assert.match(ports.preregSha256, /^sha256:[0-9a-f]{64}$/, "must be a real digest, not an empty fallback");
  assert.equal(
    ports.preregSha256,
    PREREG.sha256,
    "the request path must use the pinned literal, which ships inside the bundle",
  );

  // And the intake contract must not carry a repo path at all — the field's
  // absence is what stops the next person wiring a reader back in.
  assert.equal(
    "repoRoot" in (ports as unknown as Record<string, unknown>),
    false,
    "IntakePorts must not carry a repo root: nothing in the request path may assume a repository",
  );
} finally {
  process.chdir(original);
  rmSync(nowhere, { recursive: true, force: true });
}

console.log("no-repo runtime guard passed (production intake ports need no repository on disk)");

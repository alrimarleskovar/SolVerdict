// SPDX-License-Identifier: Apache-2.0
/**
 * Intake's machine codes → the check they failed, in words a customer can act on.
 *
 * Kept out of the component so it can be tested against the server's own
 * `IntakeFailure` union: if a new refusal reason is added to intake and nobody
 * writes a message for it, the UI would print a raw code like
 * "instance-mismatch" at somebody who has no idea what an instance is.
 * lib/evidence-refusals.test.ts fails instead.
 *
 * Two codes are deliberately unmapped. `bad-request` and `storage` are not the
 * customer's doing and have no action attached — those fall back to the
 * server's `detail` string, which is more useful than a guessed instruction.
 */
import type { TKey } from "./i18n";

export interface Refusal {
  /** Which of intake's four checks rejected the bundle. */
  check: TKey;
  /** What went wrong and what to do about it. */
  body: TKey;
}

export const REFUSAL: Record<string, Refusal> = {
  // 0/3 — format and methodology: the harness is out of date.
  "unsupported-format": { check: "ev.check.methodology", body: "ev.err.unsupported-format" },
  "prereg-mismatch": { check: "ev.check.methodology", body: "ev.err.prereg-mismatch" },
  // 1 — integrity: these bytes are not the bytes the manifest describes.
  "manifest-mismatch": { check: "ev.check.integrity", body: "ev.err.manifest-mismatch" },
  "malformed-bundle": { check: "ev.check.integrity", body: "ev.err.malformed-bundle" },
  // 2 — ownership: wrong signer, wrong audit, or the wrong moment.
  "bad-signature": { check: "ev.check.ownership", body: "ev.err.bad-signature" },
  "audit-mismatch": { check: "ev.check.ownership", body: "ev.err.audit-mismatch" },
  "already-submitted": { check: "ev.check.ownership", body: "ev.err.already-submitted" },
  "not-accepting": { check: "ev.check.ownership", body: "ev.err.not-accepting" },
  "audit-not-found": { check: "ev.check.ownership", body: "ev.err.audit-not-found" },
  // 4 — instance: the run did not use what this audit was issued.
  "instance-mismatch": { check: "ev.check.instance", body: "ev.err.instance-mismatch" },
  "unissued-cells": { check: "ev.check.instance", body: "ev.err.unissued-cells" },
};

/** Refusals with no customer-actionable advice; the server's detail is shown. */
export const UNMAPPED_ON_PURPOSE = new Set(["bad-request", "storage"]);

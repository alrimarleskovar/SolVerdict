// SPDX-License-Identifier: Apache-2.0
/**
 * Pre-registration self-certification (audit D3).
 *
 * The prereg's whole claim is "the rubric precedes the results" (§9: freeze,
 * hash, dated commit). Until now a run recorded the git commit but never the
 * DOCUMENT, so verifying that a published snapshot was scored under the frozen
 * text meant trusting that nobody edited the file between the freeze and the
 * run.
 *
 * Hashing the prereg at run time and writing the digest into run-metadata.json
 * closes that gap: the run tree carries the exact bytes of the methodology it
 * was scored under, and any later edit to the document produces a different
 * digest than the archived run claims.
 *
 * Never throws. A missing or unreadable prereg is recorded as such rather than
 * failing a campaign that is otherwise fine — an absent certificate is honest,
 * a fabricated one is not.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PREREG } from "../config/prereg.js";

export interface PreregCertificate {
  file: string;
  version: string;
  /** `sha256:<hex>` over the document's exact bytes, or null if unreadable. */
  sha256: string | null;
  bytes: number | null;
  /** Set only when the document could not be read. */
  error?: string;
}

/**
 * Hashes the pre-registration document.
 *
 * @param root Repository root containing the prereg file.
 */
export function certifyPrereg(root: string): PreregCertificate {
  const file = PREREG.file;
  try {
    const bytes = readFileSync(path.join(root, file));
    return {
      file,
      version: PREREG.version,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      bytes: bytes.length,
    };
  } catch (err) {
    return {
      file,
      version: PREREG.version,
      sha256: null,
      bytes: null,
      error: `could not read ${file}: ${String(err).slice(0, 160)}`,
    };
  }
}

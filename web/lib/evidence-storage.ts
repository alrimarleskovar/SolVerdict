// SPDX-License-Identifier: Apache-2.0
/**
 * SERVER-ONLY: the shared home for submitted evidence bundles.
 *
 * WHY THIS EXISTS. Intake runs on Vercel; the worker runs on Railway. They share
 * a Postgres and nothing else — no filesystem, no /tmp, no volume. The first
 * implementation stored the archive under Vercel's `/tmp` and put that absolute
 * path in `audits.evidence_ref`, so the worker opened a path that did not exist
 * on its host and every submission died at `phase=inflate code=ENOENT`. Even on
 * one host it would have been wrong: a serverless `/tmp` does not outlive the
 * invocation, and the worker picks the job up later by design.
 *
 * That is the same mistake as the original `localhost:8899` contract — two
 * processes assumed to share a machine — and this is the same fix: put the
 * artefact somewhere both can reach and pass a reference, never a location.
 *
 * WHY SUPABASE STORAGE. It adds no vendor, no new credential and no new network
 * boundary: both sides already hold the service-role key and already talk to
 * this host. The alternative (S3/R2) would mean a second secret in two
 * deployments to solve a problem this already solves.
 *
 * PRIVACY. A bundle is the customer's run — their agent's transactions, their
 * task text, their instance. The bucket is created `public = false` and is
 * reachable only with the service role. Nothing here ever mints a public URL or
 * a signed URL: the bytes are read server-side and never handed to a browser.
 * That is the same posture SECURITY.md sets for the tables — every access
 * server-side through `supabaseAdmin()`, no untrusted client ever holding a
 * credential — extended to the object store.
 */
import type { EvidenceStore } from "./evidence-intake";
import { supabaseAdmin } from "./supabase";

/** Private bucket. Created by migration 008; never flipped to public. */
export const EVIDENCE_BUCKET = "audit-evidence";

/**
 * A stored bundle's reference: `<auditId>/<filename>`.
 *
 * A KEY, not a path and not a URL. The worker hands it straight back to `get`
 * without interpreting it, which is what keeps the two hosts from developing
 * opinions about each other's filesystems.
 */
const keyFor = (auditId: string, filename: string): string => `${auditId}/${filename}`;

/**
 * A reference produced by the retired filesystem store: an absolute path from a
 * machine that no longer exists (and, being a serverless /tmp, did not exist for
 * long). Recognisable, so the failure can say what actually happened instead of
 * reporting a missing object.
 */
export const isLegacyLocalRef = (ref: string): boolean => ref.startsWith("/");

export function supabaseEvidenceStore(bucket: string = EVIDENCE_BUCKET): EvidenceStore {
  return {
    async put(auditId, filename, bytes) {
      // basename for the same reason the filesystem store used it: `filename`
      // derives from the client-declared run id. A key with `..` in it is not a
      // traversal here the way it is on a filesystem, but a key that is not the
      // one we think we wrote is its own problem.
      const key = keyFor(auditId, filename.split("/").pop() ?? "bundle.tar.gz");
      const { error } = await supabaseAdmin()
        .storage.from(bucket)
        .upload(key, bytes, {
          contentType: "application/gzip",
          // Intake refuses a second submission before it gets here
          // (`evidence_ref` non-null), so an existing object means a retry after
          // a partial failure rather than an overwrite of scored evidence.
          upsert: true,
        });
      if (error) throw new Error(`could not store the bundle: ${error.message}`);
      return key;
    },

    async get(ref) {
      if (isLegacyLocalRef(ref)) {
        throw new Error(
          `evidence_ref ${ref} is a filesystem path from the retired local store — ` +
            `that bundle lived on an ephemeral serverless disk and is gone. The audit must be resubmitted.`,
        );
      }
      const { data, error } = await supabaseAdmin().storage.from(bucket).download(ref);
      if (error || !data) throw new Error(`could not read the bundle: ${error?.message ?? "not found"}`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

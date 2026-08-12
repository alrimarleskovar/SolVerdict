-- SPDX-License-Identifier: Apache-2.0
--
-- ONE-OFF DATA FIX — audit e7360b8a, the first real SAK customer report.
--
-- WHAT WENT WRONG. `audits.model` was submitted as "sak+claude", which is a
-- setup id from the FROZEN OFFICIAL ROSTER (config/roster.ts), not a model name.
-- The model that actually ran was claude-sonnet-4-6. The submit form's model
-- field is free text with `claude-sonnet-4-6` as its placeholder, so nothing
-- offered the roster id — but nothing refused it either, and the PDF printed
-- `Model: sak+claude` in the same weight as the row below it that the page calls
-- verified. On a report whose whole job is separating what we measured from what
-- we were told, that reads as a pre-registered board result.
--
-- WHY THIS IS SAFE TO REWRITE. `model` is a DECLARED field: it is not an input
-- to scoring, it is not covered by the wallet's signature over the evidence
-- manifest, and no number on the placard depends on it. Correcting it changes
-- what the report SAYS about the agent, not what was measured. The verified
-- identity — `results->>'setupId'`, read out of the signed bundle — is not
-- touched here and must never be rewritten by hand: that field's value is that
-- the server did not choose it.
--
-- ============================================================================
-- CORRECTION (2026-08-12) — THE FIRST VERSION OF THIS FILE DID NOT WORK.
--
-- Its rationale said "the PDF is built on demand from the row ... there is no
-- cached artifact to invalidate". The first half is false for the identity
-- fields specifically, and that is the half that mattered.
--
-- There are TWO copies of the declared identity and they have different
-- lifetimes:
--
--   audits.model            — the live column. Mutable. rowToRecord maps it to
--                             record.form.model (web/lib/supabase.ts:91-98).
--   audits.results->>'model' — a FROZEN COPY, written once by the worker at
--                             scoring time (web/worker/run-audit.ts:155-156
--                             passes row.model into rescoreSubmission, whose
--                             output is persisted whole as `results` at :185).
--
-- The PDF renders the FROZEN copy — buildAuditPdf takes an AuditResult and
-- prints `result.model` (web/lib/audit-pdf.ts:246). It never sees record.form.
-- So updating the column alone changed nothing on the PDF.
--
-- The verify block below made this invisible: it selected `model` (the column
-- this file fixes) and `results->>'setupId'` (the field this file deliberately
-- does not touch) — never `results->>'model'`, the one the report prints. It
-- returned exactly what a successful fix looks like. It is corrected below to
-- read both copies so they can be seen to agree.
--
-- The column update is retained, but its role has changed. When this divergence
-- was found the audit detail page read record.form.model — so the column fix
-- landed there and nowhere else, and page and PDF disagreed for this audit.
-- The page now reads record.result like the PDF does, so there is exactly one
-- rendered source and the two cannot drift apart again. The column is kept
-- correct because it is what the worker would freeze into `results` if this
-- audit were ever re-scored; nothing renders it today.
-- ============================================================================
--
-- The guards in the WHERE clauses are deliberate: they make each statement a
-- no-op if the value is anything other than the one wrong string, so a re-run
-- cannot overwrite a later correction. Running this whole file again after it
-- has succeeded is safe and updates zero rows.

-- 1. The live column. Already applied; re-runs as a no-op.
update audits
   set model = 'claude-sonnet-4-6'
 where id::text like 'e7360b8a%'
   and model = 'sak+claude';

-- 2. The frozen copy the PDF actually prints, AND the record that it was
--    changed — in ONE statement, deliberately.
--
--    They were two statements in a draft of this file, and that was wrong: the
--    correction record was guarded on the value already being corrected, so
--    running the file against a row whose model had never been "sak+claude"
--    would have written a declaredCorrections entry for a correction that never
--    happened. A report claiming an edit it did not undergo is the same class of
--    lie as one hiding an edit it did. Fused, the guard is the pre-correction
--    value for both halves: either the row is the broken one and gets both, or
--    it is untouched.
--
--    `from` is the submitted string and is not optional — web/lib/types.ts
--    DeclaredCorrection requires it, and both surfaces print it. Dropping it
--    would let the report read as though it had always said the corrected value.
--
--    jsonb_set with create_missing = false on `model`: a results object somehow
--    lacking the key is left alone rather than having one invented. The append
--    uses `||` over coalesce(...,'[]') so a second, later correction to
--    `framework` would extend the array rather than replace it.
--
--    The added key is inert for existing readers: `results` is cast to the
--    AuditResult TS interface with no runtime schema validation, and
--    declaredCorrections is optional.
update audits
   set results = jsonb_set(
         jsonb_set(results, '{model}', '"claude-sonnet-4-6"'::jsonb, false),
         '{declaredCorrections}',
         coalesce(results->'declaredCorrections', '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'field',  'model',
             'from',   'sak+claude',
             'to',     'claude-sonnet-4-6',
             'at',     '2026-08-12',
             'reason', 'declared model was an official roster setup id, not a model name'
           )
         ),
         true)
 where id::text like 'e7360b8a%'
   and results->>'model' = 'sak+claude';

-- Verify. THE POINT OF THIS BLOCK IS THAT IT READS THE RENDERED FIELD. The
-- previous version selected `model` — the column the file had just written —
-- and reported success while the PDF still printed "sak+claude". An assertion
-- aimed at the value you just set proves only that you set it.
-- `results->>'model'` is what buildAuditPdf prints and what the audit page now
-- shows; that is the field to read to know what the customer is looking at.
--
-- Expect exactly one row where:
--   * results_model is claude-sonnet-4-6 — THIS is the rendered value,
--   * copies_agree is true (the live column matches, so a future re-score
--     would not resurrect the wrong string),
--   * declared_corrections holds ONE entry whose `from` is "sak+claude": the
--     submitted value, which both surfaces print alongside the corrected one,
--   * setup_id is NOT one of the four roster ids. If it comes back as one, the
--     bundle itself declared it and this file is not sufficient: that case is
--     refused at intake now (reason "reserved-setup-id") and would need the
--     customer to re-run with their own id.
--   * framework_build_* is whatever the bundle fingerprint says, untouched.
select id,
       model                                     as column_model,
       results->>'model'                         as results_model,      -- what the PDF prints
       model = results->>'model'                 as copies_agree,
       framework                                 as column_framework,
       results->>'framework'                     as results_framework,
       results->>'setupId'                       as setup_id,           -- verified; never hand-edited
       results->'frameworkBuild'->>'id'          as framework_build_id,
       results->'frameworkBuild'->>'version'     as framework_build_version,
       results->'declaredCorrections'            as declared_corrections
  from audits
 where id::text like 'e7360b8a%';

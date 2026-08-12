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
-- WHY NO REGENERATION STEP. The PDF is built on demand from the row
-- (web/app/api/audit/[id]/pdf/route.ts reads the record and calls
-- buildAuditPdf), so the corrected value appears on the next download at the
-- same URL. There is no cached artifact to invalidate.
--
-- The guard in the WHERE clause is deliberate: it makes the statement a no-op if
-- the value is anything other than the one wrong string, so a re-run cannot
-- overwrite a later correction.

update audits
   set model = 'claude-sonnet-4-6'
 where id::text like 'e7360b8a%'
   and model = 'sak+claude';

-- Verify: expect exactly one row, model = claude-sonnet-4-6, and a setup id that
-- is NOT a roster name. If setup_id comes back as one of the four core ids, the
-- bundle itself declared it and the fix above is not sufficient — that case is
-- refused at intake now (reason "reserved-setup-id") and would need the customer
-- to re-run with their own id.
select id,
       framework,
       model,
       results->>'setupId'                       as setup_id,
       results->'frameworkBuild'->>'id'          as framework_build_id,
       results->'frameworkBuild'->>'version'     as framework_build_version
  from audits
 where id::text like 'e7360b8a%';

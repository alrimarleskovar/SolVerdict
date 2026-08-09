-- Evidence intake (step 7 part 1). ADDITIVE AND UNAPPLIED.
--
-- Everything here is add-only: two nullable columns and one widened CHECK.
-- Nothing existing changes meaning, so applying it to a live database does not
-- alter the behaviour of the current flow, and dropping the two columns undoes
-- it completely. That is deliberate — part 1 must stay reversible.
--
--   evidence_ref       where the verified bundle was stored. NULL until the
--                      customer submits, and the presence of a value is what
--                      makes intake single-shot (a second POST is refused).
--   evidence_manifest  the manifest as received: run id, prereg digest, archive
--                      digest, cell list. Kept for provenance and disputes; the
--                      verdict is re-derived from the bundle, never from this.
--
-- 'awaiting_evidence' is the state an audit sits in between "created" and
-- "the customer sent their run". It has no producer yet: submit_audit still
-- writes 'queued' and still enqueues immediately. Switching that over is PART 2,
-- and it has to land together with the worker, because a 'queued' audit with no
-- evidence is a job the re-scoring worker can only fail.
--
-- DEPLOYMENT ORDER FOR PART 2 (worker and flow must move together):
--   1. apply this migration and 005 (issuance)
--   2. change submit_audit to write 'awaiting_evidence' and NOT enqueue
--   3. deploy the re-scoring worker
--   4. drain any audits still queued under the old agent-driving flow first,
--      or they will fail with "queued with no evidence bundle"

alter table audits add column if not exists evidence_ref      text;
alter table audits add column if not exists evidence_manifest jsonb;

alter table audits drop constraint if exists audits_status_check;
alter table audits add  constraint audits_status_check check (status in (
  'awaiting_payment', 'awaiting_evidence', 'queued', 'running', 'done', 'failed', 'payment_failed'));

comment on column audits.evidence_ref is
  'Storage reference for the verified evidence bundle. Non-null means evidence was accepted; intake refuses a second submission.';
comment on column audits.evidence_manifest is
  'Manifest as submitted (provenance only — the verdict is re-derived from the bundle itself).';

create index if not exists idx_audits_awaiting_evidence
  on audits (created_at) where status = 'awaiting_evidence';

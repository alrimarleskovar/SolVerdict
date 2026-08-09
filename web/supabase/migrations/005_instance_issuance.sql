-- Instance issuance (prereg §2.3 "public rules, private instances", step 6).
--
-- Each audit gets its own instance: its own destination addresses, its own
-- category-F mints. Two columns, and only one of them is authoritative.
--
--   instance_seed    32 random bytes, hex. THE source of truth. The whole
--                    instance is a pure function of (seed, audit id), so it can
--                    be re-derived years later to re-score or settle a dispute.
--   issued_instance  what was derived and handed to the client. A CACHE, kept
--                    so serving a running audit does not re-derive on every
--                    poll. issuance/derive.ts::assertMatchesSeed re-derives and
--                    refuses to score if the two ever disagree, so editing this
--                    column cannot change a verdict — it can only fail loudly.
--
-- instance_seed is a secret with the same standing as the scoring thresholds: a
-- client holding it can predict every address it is about to be issued, which
-- is exactly what issuance withholds. RLS is off on this schema (see
-- SECURITY.md) and access runs through the service role, so the compensating
-- control is that no client-reachable module may select this column. The
-- lib/server-only-secrets guard covers the module that reads it.

alter table audits add column if not exists instance_seed   text;
alter table audits add column if not exists issued_instance jsonb;

comment on column audits.instance_seed is
  'SECRET. 32-byte hex seed the per-audit instance is derived from (issuance/derive.ts). Never serve to a client.';
comment on column audits.issued_instance is
  'Cache of the derived instance handed to the client. Authority is instance_seed; a mismatch fails scoring.';

-- Audits issued before this migration have no instance and are scored against
-- the pre-registered fixtures, exactly as they were run. Left NULL on purpose:
-- backfilling a seed would claim an instance was issued when none was.

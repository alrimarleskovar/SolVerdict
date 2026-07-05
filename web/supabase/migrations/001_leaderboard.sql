-- SPDX-License-Identifier: Apache-2.0
-- Sprint 6 — public leaderboard opt-in.
-- Apply to an existing Sprint 5 database (the canonical schema.sql already
-- includes these for fresh installs).

alter table audits add column if not exists public_opt_in boolean not null default false;

-- Fast lookup of the public, ranked board.
create index if not exists idx_audits_public on audits (public_opt_in, created_at desc)
  where public_opt_in = true;

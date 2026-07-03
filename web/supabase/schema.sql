-- SPDX-License-Identifier: Apache-2.0
-- SolVerdict SaaS — Supabase Postgres schema (Sprint 5).
--
-- Replaces the Upstash Redis queue+state. The always-on Railway worker and the
-- Next.js API routes both connect with the SERVICE_ROLE key. Row Level Security
-- is left DISABLED initially (service_role bypasses it anyway); enable RLS with
-- read-only anon policies before exposing any client-side query (see bottom).
--
-- Apply with: psql "$SUPABASE_DB_URL" -f web/supabase/schema.sql
-- (or paste into the Supabase SQL editor).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists audits (
  id                uuid primary key,
  wallet            text not null,
  endpoint          text not null,
  framework         text not null,
  model             text not null,
  email             text,
  tier              text not null check (tier in ('free', 'paid')),
  status            text not null check (status in (
                      'awaiting_payment', 'queued', 'running', 'done', 'failed', 'payment_failed')),
  n                 integer not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  payment_signature text,
  started_at        timestamptz,
  finished_at       timestamptz,
  results           jsonb,
  progress          jsonb,
  error             text
);

-- 24h free-tier rate limit, one row per wallet.
create table if not exists free_tier_usage (
  wallet        text primary key,
  last_audit_at timestamptz not null default now()
);

-- Work queue with atomic claiming (FOR UPDATE SKIP LOCKED).
create table if not exists queue (
  audit_id    uuid primary key references audits(id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  claimed_at  timestamptz,
  claimed_by  text
);

-- Append-only audit trail.
create table if not exists audit_events (
  id         bigint generated always as identity primary key,
  audit_id   uuid not null references audits(id) on delete cascade,
  event_type text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_audits_wallet_created on audits (wallet, created_at desc);
create index if not exists idx_queue_unclaimed on queue (enqueued_at) where claimed_at is null;
create index if not exists idx_audit_events_audit_created on audit_events (audit_id, created_at);

-- ---------------------------------------------------------------------------
-- Functions (transactional — called via supabase.rpc)
-- ---------------------------------------------------------------------------

-- Create an audit atomically. For the free tier this also enforces the 24h
-- cooldown (claiming the free slot) and enqueues the work in the SAME
-- transaction. Returns one of: 'queued', 'awaiting_payment', 'free_limit'.
create or replace function submit_audit(
  p_id uuid,
  p_wallet text,
  p_endpoint text,
  p_framework text,
  p_model text,
  p_email text,
  p_tier text,
  p_n integer
) returns text
language plpgsql
as $$
declare
  v_claimed boolean := false;
begin
  if p_tier = 'free' then
    -- Insert-or-update the wallet's usage row only if the last audit is >24h old.
    insert into free_tier_usage as f (wallet, last_audit_at)
    values (p_wallet, now())
    on conflict (wallet) do update
      set last_audit_at = now()
      where f.last_audit_at < now() - interval '24 hours'
    returning true into v_claimed;

    if not coalesce(v_claimed, false) then
      return 'free_limit';
    end if;

    insert into audits (id, wallet, endpoint, framework, model, email, tier, status, n)
    values (p_id, p_wallet, p_endpoint, p_framework, p_model, p_email, 'free', 'queued', p_n);
    insert into queue (audit_id) values (p_id);
    return 'queued';
  else
    insert into audits (id, wallet, endpoint, framework, model, email, tier, status, n)
    values (p_id, p_wallet, p_endpoint, p_framework, p_model, p_email, 'paid', 'awaiting_payment', p_n);
    return 'awaiting_payment';
  end if;
end;
$$;

-- Move a verified paid audit to the queue (idempotent). Returns the new status.
create or replace function enqueue_paid(p_id uuid, p_signature text)
returns text
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from audits where id = p_id for update;
  if v_status is null then
    return 'not_found';
  end if;
  if v_status in ('queued', 'running', 'done') then
    return v_status; -- already progressed
  end if;

  update audits
    set status = 'queued', payment_signature = p_signature, updated_at = now()
    where id = p_id;
  insert into queue (audit_id) values (p_id) on conflict (audit_id) do nothing;
  insert into audit_events (audit_id, event_type, payload)
    values (p_id, 'payment_verified', jsonb_build_object('signature', p_signature));
  return 'queued';
end;
$$;

-- Atomically claim the next unclaimed audit for a worker. Returns its id or null.
create or replace function claim_next_audit(p_worker_id text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select q.audit_id into v_id
    from queue q
    where q.claimed_at is null
    order by q.enqueued_at
    for update skip locked
    limit 1;

  if v_id is null then
    return null;
  end if;

  update queue set claimed_at = now(), claimed_by = p_worker_id where audit_id = v_id;
  update audits set status = 'running', started_at = now(), updated_at = now() where id = v_id;
  insert into audit_events (audit_id, event_type, payload)
    values (v_id, 'claimed', jsonb_build_object('worker', p_worker_id));
  return v_id;
end;
$$;

-- Release claims held by a worker that died mid-audit (crash / SIGKILL). Any
-- claimed-but-unfinished audit older than the cutoff is requeued.
create or replace function reclaim_stale_claims(p_older_than_minutes integer default 15)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with stale as (
    update queue
      set claimed_at = null, claimed_by = null
      where claimed_at is not null
        and claimed_at < now() - make_interval(mins => p_older_than_minutes)
      returning audit_id
  )
  update audits set status = 'queued', updated_at = now()
    where id in (select audit_id from stale) and status = 'running';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS (enable before exposing client-side reads)
-- ---------------------------------------------------------------------------
-- The worker + API use service_role and bypass RLS. When you add client-side
-- reads with the anon key, enable RLS and add a read-only policy, e.g.:
--
--   alter table audits enable row level security;
--   create policy audits_read_by_id on audits for select using (true);
--
-- (Audit ids are unguessable UUIDs, so "select by id" is the privacy model.)

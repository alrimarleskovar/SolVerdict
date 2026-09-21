-- The rulecheck record store: sealed records, append-only, addressable only by
-- a digest this database does not hold.
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON audits. RULECHECK.md §8(e) requires
-- that the rulecheck surface and the benchmark do not meet: "a rulecheck record
-- can never affect a leaderboard row, a containment rate, a tier, or any
-- published benchmark number. The pipelines do not meet." They share this
-- Postgres and the one client factory that reads the service-role key
-- (lib/supabase.ts), and nothing else — no foreign key to audits, no shared
-- row, no view joining the two. rulecheck/rulecheck.test.ts holds that line in
-- the code; this file holds it in the schema.
--
-- WHAT A ROW IS. `sealed` is a signed record envelope encrypted under a key
-- derived from its own binding digest (rulecheck/seal.ts), and `lookup_key` is
-- a hash of that same digest. A reader who holds the digest can find the row
-- and open it. A reader holding this table can do neither: there is no second
-- key, and we do not have one either. That is the point — §8(c) calls a store
-- we can read on demand "a standing incident and subpoena surface built on top
-- of customers' transaction histories", and this is the structural answer to
-- it rather than a policy about who may run which query.
--
-- WHAT IS IN THE CLEAR, AND WHY. record_sha256 (a hash, so it names nothing on
-- its own), key_id (already public in rulecheck/keys.ts), the two chain links
-- (they cannot be sealed and still be checkable), and appended_at. Reading the
-- whole table therefore reveals how many records exist and when they were
-- appended — nothing about whose they are.
--
-- RLS IS ON, WITH NO POLICIES, DELIBERATELY. The other tables in this database
-- have RLS disabled and rely on every access going through the service role
-- (SECURITY.md). This table does better, for the same reason migration 008
-- added no policy to its bucket: with RLS enabled and no policy, anon and
-- authenticated match nothing and can do nothing, while service_role bypasses
-- RLS by design. The absence of a policy IS the access control. Adding a
-- permissive policy "so it works" would be the mistake.
--
-- SAFE TO APPLY WHILE LIVE. Purely additive: a new table and a new function,
-- both unreferenced until the matching deploy ships. Nothing reads or writes
-- them yet. Applying this BEFORE that deploy is the correct order.

-- --------------------------------------------------------------------------
-- The table
-- --------------------------------------------------------------------------
create table if not exists rulecheck_records (
  -- Position in the append-only chain. A gap would mean a deleted row, which is
  -- exactly what the chain exists to make visible.
  seq              bigserial primary key,

  -- sha256(domain || binding digest), hex. The only way in. UNIQUE is what
  -- makes a repeat request idempotent instead of issuing a second record for
  -- the same bytes, policy and slot.
  lookup_key       text        not null unique check (lookup_key ~ '^[0-9a-f]{64}$'),

  -- sha256 of the record's canonical JSON, hex. The chain commits to this.
  record_sha256    text        not null check (record_sha256 ~ '^[0-9a-f]{64}$'),

  -- Which published registry entry signed the envelope (rulecheck/keys.ts).
  key_id           text        not null check (key_id ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),

  -- The signed envelope, sealed. base64 of version || nonce || tag || ciphertext.
  sealed           text        not null,

  -- The chain: prev_chain_hash is the head this append named, chain_hash is the
  -- head after it. Both are computed by the application (rulecheck/chain.ts) so
  -- that a third party can recompute them from the open-source core; this
  -- database only enforces that an append names the current head.
  prev_chain_hash  text        not null check (prev_chain_hash ~ '^[0-9a-f]{64}$'),
  chain_hash       text        not null unique check (chain_hash ~ '^[0-9a-f]{64}$'),

  appended_at      timestamptz not null default now()
);

alter table rulecheck_records enable row level security;

-- --------------------------------------------------------------------------
-- The append
-- --------------------------------------------------------------------------
-- One call, three possible answers, and no way to write a broken chain:
--
--   'appended'   the row was written; its columns come back.
--   'exists'     this lookup_key was already held; the row already there comes
--                back untouched, and the caller's envelope is discarded. The
--                first record for a digest is the one that stands.
--   'head-moved' nothing was written, because p_prev_chain_hash is no longer
--                the head; the real head comes back in chain_hash so the caller
--                can relink and retry.
--
-- The advisory lock makes read-head-then-insert atomic. Without it two
-- concurrent appends can both read the same head and both insert, and the
-- chain forks silently — the one failure mode that would make the whole
-- append-only claim worthless. It is transaction-scoped, so it is released
-- whether this commits or rolls back.
create or replace function rulecheck_append_record(
  p_lookup_key      text,
  p_record_sha256   text,
  p_key_id          text,
  p_sealed          text,
  p_prev_chain_hash text,
  p_chain_hash      text
) returns table (
  status          text,
  seq             bigint,
  record_sha256   text,
  key_id          text,
  sealed          text,
  prev_chain_hash text,
  chain_hash      text,
  appended_at     timestamptz
)
language plpgsql
as $$
declare
  v_row  rulecheck_records;
  v_head text;
begin
  -- Idempotent read first, outside the lock: a repeat request is the common
  -- case and does not need to serialise behind other appends.
  select * into v_row from rulecheck_records r where r.lookup_key = p_lookup_key;
  if found then
    return query select 'exists'::text, v_row.seq, v_row.record_sha256, v_row.key_id,
                        v_row.sealed, v_row.prev_chain_hash, v_row.chain_hash, v_row.appended_at;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('rulecheck_records.chain'));

  select r.chain_hash into v_head from rulecheck_records r order by r.seq desc limit 1;
  v_head := coalesce(v_head, repeat('0', 64));

  if v_head <> p_prev_chain_hash then
    -- Nothing written. chain_hash carries the current head, not this attempt's.
    return query select 'head-moved'::text, null::bigint, null::text, null::text,
                        null::text, null::text, v_head, null::timestamptz;
    return;
  end if;

  -- Another request may have inserted this same lookup_key between the read
  -- above and this lock. `on conflict do nothing` turns that race into the
  -- idempotent answer rather than a unique-violation error.
  insert into rulecheck_records (lookup_key, record_sha256, key_id, sealed, prev_chain_hash, chain_hash)
  values (p_lookup_key, p_record_sha256, p_key_id, p_sealed, p_prev_chain_hash, p_chain_hash)
  on conflict (lookup_key) do nothing
  returning * into v_row;

  if v_row.seq is null then
    select * into v_row from rulecheck_records r where r.lookup_key = p_lookup_key;
    return query select 'exists'::text, v_row.seq, v_row.record_sha256, v_row.key_id,
                        v_row.sealed, v_row.prev_chain_hash, v_row.chain_hash, v_row.appended_at;
    return;
  end if;

  return query select 'appended'::text, v_row.seq, v_row.record_sha256, v_row.key_id,
                      v_row.sealed, v_row.prev_chain_hash, v_row.chain_hash, v_row.appended_at;
end;
$$;

-- The function is reachable only by the role that already bypasses RLS. anon
-- and authenticated hold no credential in this application (SECURITY.md), and
-- revoking here means that stays true even if one is ever handed out.
revoke all on function rulecheck_append_record(text, text, text, text, text, text) from public;
revoke all on function rulecheck_append_record(text, text, text, text, text, text) from anon, authenticated;

-- --------------------------------------------------------------------------
-- Verify after applying
-- --------------------------------------------------------------------------
--   select relrowsecurity from pg_class where relname = 'rulecheck_records';
--     expect: t
--   select count(*) from pg_policies where tablename = 'rulecheck_records';
--     expect: 0
--   select proname from pg_proc where proname = 'rulecheck_append_record';
--     expect: one row

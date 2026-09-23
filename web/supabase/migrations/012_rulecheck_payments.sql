-- The rulecheck spent-set: at most one settled payment per binding digest, ever.
--
-- WHY THE RECORD IS APPENDED BEFORE THE PAYMENT IS SETTLED. x402 has no refund.
-- Whichever of the two steps goes second is the one that can leave a party
-- short, so the order decides who carries the residual risk. Settling first
-- would mean a caller whose record could not then be signed or appended has
-- paid for nothing and we have no way to give the money back. Appending first
-- means the opposite residual: a record exists that nobody paid for, which
-- costs us a signature and a row and costs the caller nothing. The order is a
-- choice to carry that risk here rather than hand it to the customer.
--
-- WHAT THE RESIDUAL LOOKS LIKE IN THIS TABLE, AND WHY IT IS VISIBLE. A row with
-- `record_appended` true and status 'declined' or 'unknown' IS an unpaid
-- record: the append succeeded and the settlement did not. It is not deleted
-- and the record is not withdrawn — the chain in 011 is append-only, and a
-- store that quietly dropped rows would forfeit exactly the property it exists
-- for. So the unpaid record stays, addressable by a digest its holder can pay
-- for later, and countable here without holding a single digest:
--
--   select count(*) from rulecheck_payments p
--    where p.record_appended and p.status in ('declined','unknown')
--      and not exists (select 1 from rulecheck_payments q
--                       where q.digest_tag = p.digest_tag and q.status = 'settled');
--
-- A caller can also induce that state deliberately, by moving the funds out
-- from under a payment between /verify and /settle. What it buys them is a
-- record they are not handed and cannot read: the route returns the record only
-- against a settled row, and any future read path must do the same. What it
-- costs us is one signature and one chain link per attempt, and their own
-- network fee per attempt.
--
-- WHAT A ROW IS, AND WHAT IT DELIBERATELY IS NOT. One row per payment
-- presented. The key is the hash of the payment transaction's MESSAGE, because
-- that exists the moment the payer signs, and the on-chain signature does not:
-- in the x402 exact scheme the transaction id is the facilitator's fee-payer
-- signature, added at settlement. Keying on it would mean reserving nothing
-- until after the money moved. `digest_tag` is the memo the payer signed — an
-- HMAC of the binding digest under a key this database does not hold — so this
-- table names no binding digest, no record and no transaction bytes. It cannot
-- be joined to rulecheck_records: that join needs the digest, and neither table
-- has it. §8(e)'s "we cannot produce a customer's record on request" survives
-- the payment path, which is the point of not simply storing the digest here.
--
-- ONE LIVE CLAIM PER DIGEST. The partial unique index is the spent-set proper:
-- while a payment for a digest is claimed, settled or unknown, no second
-- payment for that digest can be claimed, so a digest is settled at most once
-- however many payments are presented for it. 'declined' and 'released' rows
-- are not live, which is what lets a caller pay again after a settlement was
-- refused — the case above, where the record is already waiting.
--
-- RLS IS ON, WITH NO POLICIES, for the reason migration 011 gives: anon and
-- authenticated match nothing, service_role bypasses RLS, and the absence of a
-- policy IS the access control.
--
-- SAFE TO APPLY WHILE LIVE. Purely additive: a new table, three new functions,
-- all unreferenced until the route that uses them ships. Applying this BEFORE
-- that deploy is the correct order.

-- --------------------------------------------------------------------------
-- The table
-- --------------------------------------------------------------------------
create table if not exists rulecheck_payments (
  -- sha256 over the payment transaction's message bytes, hex. One row per
  -- payment, and the only identifier available before settlement.
  payment_key      text        primary key check (payment_key ~ '^[0-9a-f]{64}$'),

  -- The memo the payer signed: HMAC(server key, domain || binding digest), hex.
  -- Not the digest, not rulecheck_records.lookup_key, and not derivable from
  -- either without the key and the digest.
  digest_tag       text        not null check (digest_tag ~ '^[0-9a-f]{64}$'),

  --   claimed   this payment holds the digest; settlement not yet resolved.
  --   settled   the facilitator reported the transfer landed. Terminal.
  --   declined  the facilitator refused it, definitively. Terminal.
  --   released  the claim was dropped before settlement was attempted, so no
  --             money moved and no record was appended for it.
  --   unknown   settlement was attempted and its outcome is not known — a
  --             timeout, not a refusal. Still live, because the transfer may
  --             have landed, and a second payment must not be taken until it
  --             is resolved against the chain.
  status           text        not null check (status in ('claimed','settled','declined','released','unknown')),

  -- The slot the quote bound, so a caller returning after the quote window can
  -- still be given the record that was already issued for it. Public: a
  -- payment lands within seconds of the slot it was quoted at.
  slot             bigint      not null check (slot >= 0),

  payer            text        not null check (payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount           text        not null check (amount ~ '^[0-9]{1,20}$'),
  network          text        not null,
  -- Which facilitator was asked. The route can be pointed at another one, and
  -- a row must still say who settled it.
  facilitator      text        not null,

  -- Set true after the record is in the chain and BEFORE settlement is
  -- attempted, so that a process that dies between the two leaves the fact
  -- behind rather than taking it with it.
  record_appended  boolean     not null default false,

  settle_signature text        check (settle_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table rulecheck_payments enable row level security;

-- The spent-set: one live claim per digest.
create unique index if not exists idx_rulecheck_payments_live_claim
  on rulecheck_payments (digest_tag)
  where status in ('claimed','settled','unknown');

-- One on-chain payment settles one row, and never a second.
create unique index if not exists idx_rulecheck_payments_signature
  on rulecheck_payments (settle_signature)
  where settle_signature is not null;

-- --------------------------------------------------------------------------
-- Claiming a digest for a payment
-- --------------------------------------------------------------------------
-- Three answers, and no way to take two payments for one digest:
--
--   'claimed'  this payment now holds the digest; go and verify it.
--   'seen'     this exact payment already has a row — the caller is retrying.
--              Its own settlement signature comes back, because it is theirs.
--   'held'     another payment holds the digest. The row comes back WITHOUT
--              its signature or payer: a second caller learns that the claim
--              is settled, which is what decides whether they are served, and
--              nothing about who settled it.
--
-- The insert is guarded by an exception handler rather than by the reads above
-- it: two requests can pass both reads and race to insert, and the unique index
-- is what decides. Reading the winner back turns that race into the same three
-- answers instead of a 500.
create or replace function rulecheck_claim_payment(
  p_payment_key   text,
  p_digest_tag    text,
  p_slot          bigint,
  p_payer         text,
  p_amount        text,
  p_network       text,
  p_facilitator   text
) returns table (
  outcome          text,
  status           text,
  slot             bigint,
  record_appended  boolean,
  settle_signature text,
  note             text,
  created_at       timestamptz
)
language plpgsql
as $$
declare
  v_row rulecheck_payments;
begin
  select * into v_row from rulecheck_payments r where r.payment_key = p_payment_key;
  if found then
    return query select 'seen'::text, v_row.status, v_row.slot, v_row.record_appended,
                        v_row.settle_signature, v_row.note, v_row.created_at;
    return;
  end if;

  select * into v_row from rulecheck_payments r
   where r.digest_tag = p_digest_tag and r.status in ('claimed','settled','unknown')
   order by r.created_at desc limit 1;
  if found then
    return query select 'held'::text, v_row.status, v_row.slot, v_row.record_appended,
                        null::text, v_row.note, v_row.created_at;
    return;
  end if;

  begin
    insert into rulecheck_payments (payment_key, digest_tag, status, slot, payer, amount, network, facilitator)
    values (p_payment_key, p_digest_tag, 'claimed', p_slot, p_payer, p_amount, p_network, p_facilitator)
    returning * into v_row;
  exception when unique_violation then
    select * into v_row from rulecheck_payments r where r.payment_key = p_payment_key;
    if found then
      return query select 'seen'::text, v_row.status, v_row.slot, v_row.record_appended,
                          v_row.settle_signature, v_row.note, v_row.created_at;
      return;
    end if;
    select * into v_row from rulecheck_payments r
     where r.digest_tag = p_digest_tag and r.status in ('claimed','settled','unknown')
     order by r.created_at desc limit 1;
    return query select 'held'::text, v_row.status, v_row.slot, v_row.record_appended,
                        null::text, v_row.note, v_row.created_at;
    return;
  end;

  return query select 'claimed'::text, v_row.status, v_row.slot, v_row.record_appended,
                      v_row.settle_signature, v_row.note, v_row.created_at;
end;
$$;

-- --------------------------------------------------------------------------
-- The row for a digest tag, whether or not it is live
-- --------------------------------------------------------------------------
-- For the caller who comes back after the quote window has closed. Their
-- payment names a digest whose slot nobody can search for any more, and the
-- record for it may already be in the chain — so the slot is read from the row
-- that recorded it. A live row is preferred over a settled-long-ago one; ties
-- go to the most recent.
create or replace function rulecheck_payment_for_tag(p_digest_tag text)
returns table (
  status           text,
  slot             bigint,
  record_appended  boolean,
  created_at       timestamptz
)
language sql
as $$
  select r.status, r.slot, r.record_appended, r.created_at
    from rulecheck_payments r
   where r.digest_tag = p_digest_tag
   order by (r.status in ('claimed','settled','unknown')) desc, r.created_at desc
   limit 1;
$$;

-- --------------------------------------------------------------------------
-- The record is in the chain
-- --------------------------------------------------------------------------
-- Called between the append and the settlement, and only from 'claimed'. If it
-- reports anything other than a claimed row, the caller must not settle: the
-- claim was resolved underneath it.
create or replace function rulecheck_mark_appended(p_payment_key text)
returns table (status text, record_appended boolean)
language plpgsql
as $$
declare
  v_row rulecheck_payments;
begin
  update rulecheck_payments r
     set record_appended = true, updated_at = now()
   where r.payment_key = p_payment_key and r.status = 'claimed'
  returning * into v_row;

  if not found then
    select * into v_row from rulecheck_payments r where r.payment_key = p_payment_key;
  end if;

  return query select v_row.status, v_row.record_appended;
end;
$$;

-- --------------------------------------------------------------------------
-- Resolving a claim
-- --------------------------------------------------------------------------
-- 'claimed' may become any of the four resolutions. 'unknown' may become
-- 'settled' or 'declined' once the chain has been read. The other three are
-- terminal and the call returns the row untouched, so a late duplicate
-- response can never turn a settled payment back into an open claim.
create or replace function rulecheck_finish_payment(
  p_payment_key      text,
  p_status           text,
  p_settle_signature text,
  p_note             text
) returns table (status text, record_appended boolean, settle_signature text)
language plpgsql
as $$
declare
  v_row rulecheck_payments;
begin
  if p_status not in ('settled','declined','released','unknown') then
    raise exception 'rulecheck_finish_payment: % is not a resolution', p_status;
  end if;

  update rulecheck_payments r
     set status           = p_status,
         settle_signature = coalesce(p_settle_signature, r.settle_signature),
         note             = coalesce(p_note, r.note),
         updated_at       = now()
   where r.payment_key = p_payment_key
     and (r.status = 'claimed' or (r.status = 'unknown' and p_status in ('settled','declined')))
  returning * into v_row;

  if not found then
    select * into v_row from rulecheck_payments r where r.payment_key = p_payment_key;
  end if;

  return query select v_row.status, v_row.record_appended, v_row.settle_signature;
end;
$$;

-- --------------------------------------------------------------------------
-- Reachable only by the role that already bypasses RLS
-- --------------------------------------------------------------------------
revoke all on function rulecheck_claim_payment(text, text, bigint, text, text, text, text) from public;
revoke all on function rulecheck_claim_payment(text, text, bigint, text, text, text, text) from anon, authenticated;
revoke all on function rulecheck_payment_for_tag(text) from public;
revoke all on function rulecheck_payment_for_tag(text) from anon, authenticated;
revoke all on function rulecheck_mark_appended(text) from public;
revoke all on function rulecheck_mark_appended(text) from anon, authenticated;
revoke all on function rulecheck_finish_payment(text, text, text, text) from public;
revoke all on function rulecheck_finish_payment(text, text, text, text) from anon, authenticated;

-- --------------------------------------------------------------------------
-- Verify after applying
-- --------------------------------------------------------------------------
--   select relrowsecurity from pg_class where relname = 'rulecheck_payments';
--     expect: t
--   select count(*) from pg_policies where tablename = 'rulecheck_payments';
--     expect: 0
--   select indexname from pg_indexes where tablename = 'rulecheck_payments';
--     expect: the primary key plus idx_rulecheck_payments_live_claim
--             and idx_rulecheck_payments_signature
--   select proname from pg_proc
--    where proname in ('rulecheck_claim_payment','rulecheck_payment_for_tag',
--                      'rulecheck_mark_appended','rulecheck_finish_payment');
--     expect: four rows

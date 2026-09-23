-- Reconciling a payment whose settlement nobody can vouch for.
--
-- WHY AN UNRESOLVED ROW IS A PRODUCTION FAILURE AND NOT A BOOKKEEPING GAP. The
-- spent-set in 012 admits one LIVE row per digest ('claimed', 'settled' or
-- 'unknown'), and that is what stops a digest being paid for twice. The same
-- index is what makes an unresolved row block everyone else: while a row sits
-- in 'claimed' or 'unknown', every other payer for that digest is answered 409
-- and never served. Two ways a row gets stuck there:
--
--   'claimed', record appended   the process died between marking the append
--                                and hearing back from /settle. Nothing will
--                                ever finish that request.
--   'unknown'                    /settle was asked and its answer was lost.
--                                012 says "resolved against the chain", and
--                                until this migration nothing read the chain.
--
-- Left alone, either one is a permanent 409 for a digest. The reconciler that
-- calls the functions below is therefore NOT an optional tidy-up: removing it
-- turns every crash or timeout into a digest nobody can buy again.
--
-- WHAT IS ADDED. One nullable column and three functions. Nothing in 012
-- changes, and the route that uses these ships after this is applied, so it is
-- safe to apply while live.
--
-- WHAT THE NEW COLUMN HOLDS, AND WHY IT IS HERE. `payment_payload` is the x402
-- payload the payer sent: the PAYMENT transaction they signed (a USDC transfer
-- and a memo carrying `digest_tag`) and the terms it was sent against. It is
-- NOT the transaction a rulecheck record is about, and it carries no binding
-- digest, so 012's rule that this table cannot be joined to rulecheck_records
-- still holds. Everything in it is already in this row (payer, amount, tag) or
-- will be public on-chain the moment it lands (the token accounts). It is
-- written together with `record_appended`, because it is needed exactly when a
-- settlement may have been submitted: the reconciler reads the blockhash out of
-- it, and a resubmission sends it again byte for byte. A row appended before
-- this migration has no payload and is reported for resolution by hand.

alter table rulecheck_payments add column if not exists payment_payload jsonb;

-- --------------------------------------------------------------------------
-- The record is in the chain, and here is the payment that will pay for it
-- --------------------------------------------------------------------------
-- Replaces the route's call to rulecheck_mark_appended (012), which stays
-- defined and unused. Same rule: only from 'claimed', and anything else it
-- reports means the caller must not settle.
create or replace function rulecheck_mark_appended_with_payload(p_payment_key text, p_payment_payload jsonb)
returns table (status text, record_appended boolean)
language plpgsql
as $$
declare
  v_row rulecheck_payments;
begin
  if p_payment_payload is null then
    raise exception 'rulecheck_mark_appended_with_payload: a payload is required';
  end if;

  update rulecheck_payments r
     set record_appended = true, payment_payload = p_payment_payload, updated_at = now()
   where r.payment_key = p_payment_key and r.status = 'claimed'
  returning * into v_row;

  if not found then
    select * into v_row from rulecheck_payments r where r.payment_key = p_payment_key;
  end if;

  return query select v_row.status, v_row.record_appended;
end;
$$;

-- --------------------------------------------------------------------------
-- The rows a reconciler may act on
-- --------------------------------------------------------------------------
-- 'unknown' rows always: the settlement call behind them has returned. 'claimed'
-- rows only once they are stale — older, since their last write, than any
-- request could still be working on them — so a reconciler never races a
-- request that is alive. The age is measured on the database's clock, so no
-- server's clock decides it. Optionally narrowed to one digest tag, which is
-- what the retry path asks for.
create or replace function rulecheck_payments_to_reconcile(p_digest_tag text, p_stale_seconds integer)
returns table (
  payment_key      text,
  digest_tag       text,
  status           text,
  slot             bigint,
  record_appended  boolean,
  payment_payload  jsonb,
  age_seconds      integer
)
language sql
as $$
  select r.payment_key, r.digest_tag, r.status, r.slot, r.record_appended, r.payment_payload,
         extract(epoch from now() - r.created_at)::integer
    from rulecheck_payments r
   where (p_digest_tag is null or r.digest_tag = p_digest_tag)
     and (r.status = 'unknown'
          or (r.status = 'claimed' and r.updated_at < now() - make_interval(secs => p_stale_seconds)))
   order by r.created_at
   limit 50;
$$;

-- --------------------------------------------------------------------------
-- Resolving a row, on the condition that it is still what the reconciler read
-- --------------------------------------------------------------------------
-- Compare-and-set: the row moves only if its status and `record_appended` are
-- what the caller saw. That is what stops a reconciler releasing a claim whose
-- request woke up, marked the append and submitted a settlement in between.
--
-- The transitions, and only these:
--   claimed, not appended  -> released          no settlement was ever submitted
--   claimed, appended      -> unknown | settled | declined
--   unknown                -> settled | declined
create or replace function rulecheck_resolve_payment(
  p_payment_key      text,
  p_from_status      text,
  p_from_appended    boolean,
  p_to_status        text,
  p_settle_signature text,
  p_note             text
) returns table (status text, record_appended boolean, settle_signature text, changed boolean)
language plpgsql
as $$
declare
  v_row rulecheck_payments;
begin
  if not (
       (p_from_status = 'claimed' and not p_from_appended and p_to_status = 'released')
    or (p_from_status = 'claimed' and p_from_appended and p_to_status in ('unknown','settled','declined'))
    or (p_from_status = 'unknown' and p_to_status in ('settled','declined'))
  ) then
    raise exception 'rulecheck_resolve_payment: % (appended %) to % is not a reconciliation',
      p_from_status, p_from_appended, p_to_status;
  end if;

  update rulecheck_payments r
     set status           = p_to_status,
         settle_signature = coalesce(p_settle_signature, r.settle_signature),
         note             = coalesce(p_note, r.note),
         updated_at       = now()
   where r.payment_key = p_payment_key
     and r.status = p_from_status
     and r.record_appended = p_from_appended
  returning * into v_row;

  if found then
    return query select v_row.status, v_row.record_appended, v_row.settle_signature, true;
    return;
  end if;

  select * into v_row from rulecheck_payments r where r.payment_key = p_payment_key;
  return query select v_row.status, v_row.record_appended, v_row.settle_signature, false;
end;
$$;

-- --------------------------------------------------------------------------
-- Reachable only by the role that already bypasses RLS
-- --------------------------------------------------------------------------
revoke all on function rulecheck_mark_appended_with_payload(text, jsonb) from public;
revoke all on function rulecheck_mark_appended_with_payload(text, jsonb) from anon, authenticated;
revoke all on function rulecheck_payments_to_reconcile(text, integer) from public;
revoke all on function rulecheck_payments_to_reconcile(text, integer) from anon, authenticated;
revoke all on function rulecheck_resolve_payment(text, text, boolean, text, text, text) from public;
revoke all on function rulecheck_resolve_payment(text, text, boolean, text, text, text) from anon, authenticated;

-- --------------------------------------------------------------------------
-- Verify after applying
-- --------------------------------------------------------------------------
--   select column_name from information_schema.columns
--    where table_name = 'rulecheck_payments' and column_name = 'payment_payload';
--     expect: one row
--   select proname from pg_proc
--    where proname in ('rulecheck_mark_appended_with_payload','rulecheck_payments_to_reconcile',
--                      'rulecheck_resolve_payment');
--     expect: three rows
--   select count(*) from pg_policies where tablename = 'rulecheck_payments';
--     expect: 0

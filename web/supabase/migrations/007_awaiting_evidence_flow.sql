-- The flow switch: audits wait for EVIDENCE, not for a worker.
--
-- Until now `submit_audit` (free) and `enqueue_paid` (paid) both set status
-- 'queued' and inserted a queue row immediately. That was correct while the
-- worker WAS the audit — it claimed the row and drove the customer's endpoint.
-- Since step 7 the worker re-scores a submitted bundle, so a queued audit with
-- no bundle is a job that can only fail. The queue row is now created by
-- evidence intake, after a bundle has been verified.
--
-- Both functions therefore land on 'awaiting_evidence' (added by 006) and stop
-- enqueueing. Everything else about them is untouched: the free-tier 24h
-- cooldown, the advisory lock, the paid pending cap, the payment_signature
-- write and the payment_verified event all behave exactly as before.
--
-- WHAT ISSUES THE INSTANCE. Not this migration. The 32-byte instance_seed is
-- generated in the application (web/lib/instance-issuance.ts) at the moment an
-- audit reaches 'awaiting_evidence', because the derivation that has to match
-- it at scoring time lives in TypeScript (issuance/derive.ts) and a seed the
-- database invented would have no derivation to be checked against. The seed
-- column is the authority; issued_instance is a cache. The serving route
-- re-issues idempotently, so an audit cannot be stranded if the hook is missed.
--
-- ORDERING. Requires 005 (instance_seed) and 006 (evidence columns +
-- 'awaiting_evidence' in the status CHECK). The CHECK is re-asserted below so
-- applying this out of order fails loudly rather than on the first insert; it
-- is a no-op when 006 already ran.
--
-- BEFORE APPLYING: drain audits still in 'queued' under the old flow. They have
-- no evidence_ref and the re-scoring worker will fail them.
--   select id, status from audits where status = 'queued' and evidence_ref is null;

alter table audits drop constraint if exists audits_status_check;
alter table audits add  constraint audits_status_check check (status in (
  'awaiting_payment', 'awaiting_evidence', 'queued', 'running', 'done', 'failed', 'payment_failed'));

-- --------------------------------------------------------------------------
-- submit_audit — free tier now waits for the customer's local run
-- --------------------------------------------------------------------------
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
  v_pending integer;
  -- Concurrent unpaid audits allowed per wallet. The legitimate flow needs
  -- exactly ONE; 3 leaves room for a user who resubmits after a failed wallet
  -- popup without ever being blocked, while turning "unbounded rows per wallet"
  -- into "at most 3 per 20-minute window".
  c_max_pending_paid constant integer := 3;
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

    -- No queue insert: the work starts when the customer submits evidence.
    insert into audits (id, wallet, endpoint, framework, model, email, tier, status, n)
    values (p_id, p_wallet, p_endpoint, p_framework, p_model, p_email, 'free', 'awaiting_evidence', p_n);
    return 'awaiting_evidence';
  else
    -- Serialise concurrent submits for THIS wallet so the count below cannot be
    -- read stale by a racing transaction. Released automatically at commit.
    perform pg_advisory_xact_lock(hashtext(p_wallet));

    select count(*) into v_pending
      from audits
     where wallet = p_wallet
       and status = 'awaiting_payment'
       and created_at > now() - interval '20 minutes';

    if v_pending >= c_max_pending_paid then
      return 'paid_pending_limit';
    end if;

    insert into audits (id, wallet, endpoint, framework, model, email, tier, status, n)
    values (p_id, p_wallet, p_endpoint, p_framework, p_model, p_email, 'paid', 'awaiting_payment', p_n);
    return 'awaiting_payment';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- enqueue_paid — a verified payment now unlocks the RUN, not the queue
-- --------------------------------------------------------------------------
-- Name kept: it is called from lib/payment-flow.ts and renaming an RPC in the
-- same change that alters its behaviour makes a rollback need two edits.
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
  -- 'awaiting_evidence' joins the already-progressed set so a repeated
  -- verification (retry, worker sweep, user refresh) is a no-op.
  if v_status in ('awaiting_evidence', 'queued', 'running', 'done') then
    return v_status;
  end if;

  update audits
    set status = 'awaiting_evidence', payment_signature = p_signature, updated_at = now()
    where id = p_id;
  insert into audit_events (audit_id, event_type, payload)
    values (p_id, 'payment_verified', jsonb_build_object('signature', p_signature));
  return 'awaiting_evidence';
end;
$$;

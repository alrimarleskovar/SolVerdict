-- SPDX-License-Identifier: Apache-2.0
-- Migration 004 — cap concurrent unpaid audits per wallet (finding #10).
--
-- THE GAP. The free tier is rate-limited atomically inside submit_audit
-- ('free_limit' → 429). The paid path had no creation limit at all: a wallet
-- could open unlimited `awaiting_payment` rows in a burst. resolveStuckPayment
-- only sweeps them to `payment_failed` after PAYMENT_STUCK_MS (20 minutes, see
-- lib/payment.ts), so the table can be flooded inside that window — and the
-- sweep only runs while the worker is up.
--
-- WHY IN THE RPC. Same place and same transaction as the free-tier check. A
-- JS-side count before the insert would race: two concurrent submits both read
-- "2 pending" and both insert.
--
-- WHY AN ADVISORY LOCK. The free-tier check is atomic because it is ONE
-- statement (insert … on conflict … do update where). This check cannot be:
-- it is a count followed by an insert, and Postgres takes no gap lock, so two
-- transactions could each count 2 and each insert. pg_advisory_xact_lock
-- serialises submissions per wallet for the transaction's lifetime and releases
-- on commit or rollback. Hashed on the wallet, so unrelated wallets never
-- contend.
--
-- WHY A TIME WINDOW rather than "all awaiting_payment rows". Counting every
-- pending row makes the cap depend on the sweeper: if the worker is down,
-- nothing ever clears and a legitimate user is blocked forever at the cap.
-- Counting only rows created inside the sweep window makes the limit
-- self-healing — it degrades to "3 unpaid audits per 20 minutes per wallet"
-- with no external process required.
--
-- KEEP ALIGNED: the interval below mirrors PAYMENT_STUCK_MS in lib/payment.ts.
-- If one moves, move the other.

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

    insert into audits (id, wallet, endpoint, framework, model, email, tier, status, n)
    values (p_id, p_wallet, p_endpoint, p_framework, p_model, p_email, 'free', 'queued', p_n);
    insert into queue (audit_id) values (p_id);
    return 'queued';
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

-- Serves the pending-count lookup above.
create index if not exists idx_audits_wallet_pending on audits (wallet, created_at desc)
  where status = 'awaiting_payment';

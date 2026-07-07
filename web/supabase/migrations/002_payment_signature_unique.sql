-- SPDX-License-Identifier: Apache-2.0
-- Migration 002 — enforce one on-chain payment ⇒ one audit.
--
-- HIGH-1 (pre-launch audit): audits.payment_signature had no uniqueness, so the
-- same USDC transfer signature could be written to many audit rows. Combined
-- with the (now fixed) substring memo match, one payment could unlock several
-- paid audits. This partial UNIQUE index binds each signature to at most one
-- audit at the DB level — defense in depth behind the exact-memo check in
-- lib/payment.ts.
--
-- Partial (WHERE payment_signature IS NOT NULL) so the many NULL rows
-- (free-tier and not-yet-paid audits) never collide with each other.
--
-- enqueue_paid() (schema.sql) sets payment_signature during its UPDATE; a second
-- audit trying to claim an already-used signature now raises SQLSTATE 23505,
-- which lib/payment-flow.ts catches and surfaces as a clean 409 ("payment
-- signature already used for another audit") instead of a 500.

CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_payment_signature_unique
  ON public.audits (payment_signature)
  WHERE payment_signature IS NOT NULL;

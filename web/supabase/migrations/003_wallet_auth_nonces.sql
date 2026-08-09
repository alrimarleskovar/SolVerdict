-- SPDX-License-Identifier: Apache-2.0
-- Migration 003 — wallet-ownership proof for /api/audits (finding #9).
--
-- P1 privacy leak: GET /api/audits?wallet=<pubkey> trusted its own query
-- parameter, and pubkeys are public by construction. Anyone could list any
-- wallet's whole audit history — including audits the owner never opted into
-- the public ranking. Each row carries the audit UUID, and that UUID is the
-- ONLY gate on /api/audit/<id>, which returns the full private result, the
-- submitter's email and the payment signature. So knowing a pubkey was enough
-- to read every private audit that wallet had ever run, defeating the stated
-- model ("the audit id is an unguessable UUID, so the link is the only key").
--
-- The fix proves ownership of the key before returning its history: the caller
-- signs a server-issued nonce and the API verifies the ed25519 signature
-- (lib/wallet-auth.ts). This table holds the challenges.
--
-- SINGLE USE. A stateless (HMAC) nonce would need no table but stays replayable
-- for its whole validity window. A row that is DELETED on consumption makes
-- each signature usable exactly once.
--
-- Fresh installs get this from schema.sql; this migration is for databases
-- already provisioned at Sprint 5/6. Until it is applied, POST /api/auth/nonce
-- fails CLOSED with 503 — the dashboard stops working rather than the leak
-- staying open.

create table if not exists auth_nonces (
  nonce      text primary key,
  wallet     text not null,
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Lookup is by primary key; this index only serves the sweeper below.
create index if not exists idx_auth_nonces_expiry on auth_nonces (expires_at);

-- Housekeeping: nonces are consumed on use, but an abandoned sign-in must not
-- linger. Called opportunistically by the nonce route; safe to run from cron.
create or replace function prune_expired_nonces() returns void
language sql as $$
  delete from auth_nonces where expires_at < now();
$$;

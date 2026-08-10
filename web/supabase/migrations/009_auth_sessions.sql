-- Short-lived sessions: one signature, then a window.
--
-- WHY A SIBLING TABLE AND NOT A COLUMN ON auth_nonces. The two rows mean
-- opposite things. A nonce is a single-use challenge that verifyWalletOwnership
-- DELETES the moment it is presented, whatever the outcome — that deletion is
-- the anti-replay control. A session is deliberately multi-use for its window.
-- Sharing a table means one bug away from a session being burned by the nonce
-- path, or a nonce surviving because it was mistaken for a session. Same
-- module, same primitives, same discipline; separate lifecycle, separate table.
--
-- THE TOKEN IS NOT STORED. Only its SHA-256. A nonce is useless to a thief
-- without the matching signature, so storing it plainly costs nothing; a
-- session token IS the credential, so a database leak must not yield usable
-- ones. The raw token exists only in the response that mints it and in the
-- browser that holds it.
--
-- SAFE TO APPLY WHILE LIVE. Purely additive: a new table nothing reads until
-- the matching deploy ships. Apply BEFORE deploying — the reverse leaves the
-- session endpoint inserting into a table that does not exist, which fails
-- closed (no session issued, signature path still works) but logs noise.

create table if not exists auth_sessions (
  -- SHA-256 hex of the token. The token itself is never persisted.
  token_sha256 text primary key,
  wallet       text not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- Set to end a session before it expires. Checked on every use.
  revoked_at   timestamptz
);

-- Lookup is always by primary key; this index serves pruning and any future
-- "end all sessions for this wallet" action.
create index if not exists idx_auth_sessions_wallet on auth_sessions (wallet, expires_at);

create or replace function prune_expired_sessions() returns void
language sql as $$
  -- Revoked rows are kept for one TTL so a replay of a revoked token still
  -- resolves to "revoked" rather than to "unknown" — same refusal either way,
  -- but the distinction is worth having in the table while debugging.
  delete from auth_sessions where expires_at < now() - interval '30 minutes';
$$;

comment on table auth_sessions is
  'Short-lived proof-of-ownership receipts. Minted only after verifyWalletOwnership succeeds; never a substitute for the instance or evidence signatures.';

-- Verify after applying:
--   select count(*) from auth_sessions;             -- expect 0
--   select prune_expired_sessions();                -- expect void, no error

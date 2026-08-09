# Security notes — SolVerdict web (SaaS)

Scope: the audit-as-a-service app in `web/`. The benchmark harness and the
official-run pipeline are separate and are covered by the repository root
`SECURITY.md`.

---

## The service-role key is server-only

`SUPABASE_SERVICE_ROLE_KEY` grants **full read/write on every table and bypasses
Row Level Security**. Three rules, all machine-checked by
`lib/server-only-secrets.test.ts`:

1. **Never prefixed `NEXT_PUBLIC_`.** Next.js substitutes those into the client
   bundle by definition, so the prefix alone would publish the key.
2. **Never imported from a `"use client"` module** — directly or through a chain
   of relative imports. Importing `lib/supabase` from client code inlines the key
   into the browser bundle.
3. **Read in exactly one place**, `lib/supabase.ts`. A second reader is a second
   chance to get the client/server boundary wrong.

Database access belongs in route handlers, server components, or the worker.
A client component that needs data fetches it from an API route.

## Row Level Security is currently OFF

This is a deliberate, **compensated** decision, not an oversight:

- every database access goes through `supabaseAdmin()` server-side, which uses
  service_role and would bypass RLS anyway;
- the anon key is not used by any live path. `supabaseAnon()` exists only as the
  entry point for a future client-side read path.

**The compensating control is rule 2 above.** RLS-off is safe exactly as long as
no untrusted client ever holds a database credential. That is why the boundary
is enforced by a test rather than by convention.

### Before adding any client-side read

In this order, not after the fact:

1. `alter table <t> enable row level security;`
2. add read-only policies (`schema.sql` sketches the shape at the bottom);
3. verify the anon key can read **only** what a policy allows;
4. only then wire `supabaseAnon()` into client code.

Enabling RLS after client reads already ship means running unprotected in
production for the length of that gap.

## Access control on audit results

Audit ids are unguessable UUIDs and the id **is** the capability: anyone holding
the URL can read that audit. Two consequences:

- **Never publish an audit id** on a surface the owner did not choose. This was
  finding #9: `/api/audits?wallet=` listed a wallet's ids to anyone who knew the
  pubkey, which handed over every private result. It now requires a signed
  ownership proof (`lib/wallet-auth.ts`, `POST /api/auth/nonce`).
- `public_opt_in` is a **publication** choice for the leaderboard, not an access
  control. Do not use it to decide who may read an audit.

## Rate limits

Both are enforced **inside the `submit_audit` RPC**, in the same transaction as
the insert — a check in JavaScript before the call would race two concurrent
submits past it.

| Limit | Rule | Outcome |
|---|---|---|
| Free tier | one audit per wallet per 24h | `free_limit` → 429 |
| Paid tier | at most 3 concurrent unpaid audits per wallet, within the 20-minute payment window | `paid_pending_limit` → 429 |

Per-wallet only. Wallets are free to generate, so this bounds a user's burst,
not a determined attacker; an edge/WAF rate limit on `POST /api/audit/submit` is
the recommended follow-up.

## Reporting

Security issues in the hosted app: open a GitHub issue marked `security`, or
follow the disclosure process in the repository root `SECURITY.md`.

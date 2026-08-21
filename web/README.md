# SolVerdict — web app + audit worker (Sprint 5)

A Next.js 14 (App Router, TypeScript, Tailwind) front end that lets external
developers submit their Solana agent for a safety audit and view the verdict,
plus an always-on worker that runs the audits.

It lives **inside** the SolVerdict repo and **reuses the parent bench** — it
imports `env/`, `scenarios/`, `scoring/`, and `config/` via relative paths
(`../../scoring`, …) rather than copying anything. The customer runs the 20
scenarios themselves with `@solverdict/harness`, against a local Solana mainnet
fork on their own machine, and submits a signed evidence bundle; the worker
re-derives every verdict from that bundle. Nothing here dials the agent.

As of **Sprint 5** the queue and audit state live in **Supabase Postgres** and
the worker runs as an **always-on Railway container** (previously Upstash Redis +
a GitHub Actions cron). With a continuous worker there is no sharding: every
audit runs single-shot at its full N.

```
web/
  app/
    page.tsx                     home / hero / CTA
    submit/page.tsx              submission form (framework, model, email, protocol checkbox)
    audit/[id]/page.tsx          status page: queue wait estimate, per-scenario progress, verdict placard
    docs/protocol/page.tsx       public protocol documentation
    api/audit/submit/route.ts    POST → validate + SSRF check → submit_audit RPC
    api/audit/[id]/route.ts      GET  → read audit (+ queueDepth while queued)
    api/audit/[id]/paid/route.ts POST → verify USDC payment on-chain → enqueue_paid
    api/audit/[id]/verify-payment/route.ts  POST → resolve a stuck awaiting_payment audit
  components/                    Brand, Placard
  lib/
    audit-protocol.ts            the HTTP protocol: types, validator, constants
    ssrf.ts                      SSRF guard — RETAINED, NO CALLERS (see its header)
    submission.ts                submit-form validation
    supabase.ts                  Supabase clients (admin/anon) + row→AuditRecord mapper
    payment.ts                   on-chain USDC payment verification
    payment-flow.ts              awaiting_payment → queued / payment_failed state machine
    notify.ts                    Resend email transport
    types.ts                     wire types (reuse parent SetupScore)
    placard-model.ts             SetupScore → placard view-model (reuses tierFor)
    *.test.ts                    unit tests (npm test)
  supabase/install.sh            THE install path: baseline + migrations, one transaction
  supabase/schema.sql            bootstrap baseline (Sprint 5) — NOT the current schema
  supabase/migrations/           the current state, applied in ascending order
  lib/evidence-intake.ts         verify a submitted bundle (sha256, signature, prereg, instance)
  app/api/audit/[id]/evidence/   POST endpoint the harness submits to
  worker/run-audit.ts            always-on worker: claim → re-score bundle → Supabase
  worker/rescore-audit.ts        the job body: evidence in, AuditResult out
  worker/Dockerfile              Railway image (Node 20 + pinned Surfpool 1.3.1)
  worker/queue-claim.test.ts     atomic-claim contract test
railway.json                     Railway service config (repo root)
```

## The SolVerdict submission protocol (solverdict-bundle/v1)

The customer runs the audit on their own machine with
[`@solverdict/harness`](../packages/harness) and uploads what it produces:

```
POST /api/audit/<auditId>/evidence     multipart: bundle + manifest + signature
```

- `bundle` — `<runId>.tar.gz`, the evidence tree the local runner wrote;
- `manifest` — the archive's SHA-256 plus provenance (bundle format, run id,
  the pre-registration digest the harness implements);
- `signature` — ed25519 over the manifest digest, by the wallet that owns the
  audit (`lib/wallet-auth.ts`, the same primitive as the login flow).

Intake (`lib/evidence-intake.ts`) fails closed on: unknown bundle format,
archive/manifest digest mismatch, a signature that is not the audit owner's, a
pre-registration digest that is not ours, or `ctx.params` that do not match the
instance this audit was issued. Nothing is stored or enqueued unless every check
passes.

Then the worker re-derives the verdict rather than trusting the bundle:
transaction magnitudes from the validator's pre/post balances, destinations and
program ids from the signed bytes, and the denominator from the pre-registered
N. Full spec: **`/docs/protocol`**.

> The HTTP request/response protocol this section used to describe (we POST an
> `AuditRequest`, the agent replies with unsigned transactions) was deleted in
> step 8 along with `setups/http-agent.ts`. It carried
> `rpcUrl: "http://localhost:8899"` — our fork, their loopback — so it stopped
> being implementable once the agent and the fork lived on different machines.

## Data model (Supabase)

Install with [`supabase/install.sh`](supabase/install.sh), which applies the
bootstrap baseline and then every migration in ascending order, in one
transaction:

```sh
web/supabase/install.sh "$SUPABASE_DB_URL"
```

**Do not apply `schema.sql` on its own.** It is a baseline frozen at Sprint 5,
and alone it produces a database this product cannot run against — no
`awaiting_evidence` status, no `instance_seed` / `issued_instance`, no
`evidence_ref` / `evidence_manifest`, no `auth_sessions`, and superseded
definitions of `submit_audit()` and `enqueue_paid()`. The relationship between
the two is declared in the file's own header, and
`supabase/schema-contract.test.ts` checks that the union covers everything the
code queries.

The result is:

- **`audits`** — one row per submission (status, tier, N, framework, model,
  results jsonb, progress jsonb, …). `endpoint` is a legacy column, nullable
  since migration 010 and NULL for every audit created since; it is kept so
  audits submitted before the field was removed still render what they sent.
- **`queue`** — `audit_id` PK with `claimed_at` / `claimed_by`; claimed atomically
  via `FOR UPDATE SKIP LOCKED`.
- **`free_tier_usage`** — one row per wallet, enforcing the 24h free-tier cooldown.
- **`audit_events`** — append-only trail (`claimed`, `started`, `done`, `failed`,
  `payment_verified`, …).

and these transactional RPC functions (called with the service-role key):
`submit_audit`, `enqueue_paid`, `claim_next_audit`, `reclaim_stale_claims`.

RLS is disabled initially (the API + worker use the service_role key, which
bypasses it). Enable RLS with a read-only policy before adding any anon-key
client read — see the note at the bottom of `schema.sql`.

## Run locally

```bash
cd web
npm install
# Put these in web/.env.local (see "Environment" below):
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
npm run dev                     # Next.js dev server on http://localhost:3000
```

The worker runs against a local Surfpool (launched automatically) and the same
Supabase project:

```bash
npm run worker                  # long-running: claims queued audits and runs them
```

The worker does **not** need model provider keys — the customer's agent runs on
their machine, with their keys, and never here.

Other scripts:

```bash
npm run build   # production build (also type-checks the worker + parent graph)
npm test        # tsc --noEmit + placard-model + wallet-auth + evidence-intake + landing
                #   + submit-outcomes + server-only-secrets + submission-protocol
                #   + payment + notify + supabase + queue-claim
```

## Environment

`.env.local` files are not committed (and are blocked from tooling), so set these
directly. **Web app (Vercel):**

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (server-only; API routes) |
| `SUPABASE_ANON_KEY` | anon key (reserved for future client reads) |
| `NEXT_PUBLIC_SOLVERDICT_PAYMENT_WALLET` | destination wallet shown to the client |
| `SOLVERDICT_PAYMENT_WALLET` | destination wallet the server verifies against |
| `SOLANA_RPC_URL` | RPC used for payment verification (default: mainnet-beta public) |
| `RESEND_API_KEY` | email notifications (optional) |
| `NEXT_PUBLIC_BASE_URL` | base URL used in notification links |

**Worker (Railway):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SOLVERDICT_PAYMENT_WALLET`, `SOLANA_RPC_URL`, `RESEND_API_KEY`. Optional tuning:
`WORKER_POLL_MS` (default 5000), `AUDIT_BUDGET_MS` (default 30 min),
`STALE_CLAIM_MINUTES` (default 45), `WORKER_ID`.

## Deploy

### 1. Supabase
Create a project, then run the installer against its connection string:

```sh
web/supabase/install.sh "$SUPABASE_DB_URL"
```

That is the whole step, and it is the only supported one — see *Data model*
above for why `schema.sql` alone is not enough.

### 2. Web (Vercel)
1. Import the repo and set the **Root Directory** to `web`.
2. Framework preset: **Next.js** (auto-detected).
3. Add the web env vars above (Production + Preview).
4. Deploy. The API routes run on the Node.js runtime (`node:crypto`, `node:dns`
   for the SSRF check, the Supabase client).

Because the app imports parent modules above `web/`, `next.config.js` sets
`experimental.externalDir: true` and maps `.js` import specifiers to `.ts`.

### 3. Worker (Railway)
1. New service from the repo; Railway reads [`railway.json`](../railway.json),
   which builds [`worker/Dockerfile`](worker/Dockerfile) (build context = repo
   root) and starts `npm --prefix web run worker`.
2. Add the worker env vars above.
3. Deploy. The image pins **Surfpool 1.3.1** and runs one always-on container
   (`restartPolicyType: ON_FAILURE`). Scale by raising replicas — each claims
   different audits with no coordination (`SKIP LOCKED`).

## How an audit runs

1. A submission calls `submit_audit`. **Free** audits are enqueued immediately
   (the 24h-per-wallet cooldown is enforced transactionally); **paid** audits are
   created `awaiting_payment`.
2. The client pays 10 USDC (audit id as the memo) and calls `POST /paid`. The
   route verifies amount + destination + memo on-chain and, if valid, runs
   `enqueue_paid` to move the audit to `queued`.
3. The worker loops: it periodically reclaims stale claims and resolves stuck
   payments, then `claim_next_audit` atomically takes the oldest queued audit.
4. For the claimed audit it re-scores the submitted evidence bundle
   (`worker/rescore-audit.ts`): extract, re-derive every transaction's magnitude
   from the validator's own pre/post balances, run each scenario's `check()` →
   `classifyOutcome`, and aggregate against the pre-registered denominator. No
   Surfpool and no RPC recorder — the audit already ran, on the customer's
   machine. Progress is written to `audits.progress`.
5. On completion it writes the aggregated `SetupScore` to `audits.results`, sets
   status `done` (or `failed`), deletes the queue row, and sends the email.
6. `/audit/<id>` polls the API — a queue-depth wait estimate while queued, then
   live per-scenario outcomes, then the placard.

Graceful shutdown: on `SIGTERM`/`SIGINT` the worker stops claiming and lets the
in-flight audit finish. If the platform hard-kills it mid-audit, the claim goes
stale and `reclaim_stale_claims` requeues it on the next worker's maintenance
tick. A `/tmp/worker-alive` heartbeat file (touched every 30s) backs the
container healthcheck.

## Safety (the hostile input is a *bundle*, not a URL)

Nothing in this app makes an outbound request to a user-supplied host, so the
controls are on intake. Full write-up: [`docs/THREAT_MODEL.md`](../docs/THREAT_MODEL.md).

- **The verdict is re-derived, never read from the bundle.** Magnitudes are
  recomputed from the validator's own pre/post balances; the denominator is the
  pre-registered N, so a short bundle scores *incomplete* rather than better.
- **Server-issued secret instance.** A bundle run against the public fixtures
  instead of the audit's issued instance is refused (`instance-mismatch`).
- **Wallet-signed submission** over a message distinct from the sign-in message,
  so a login signature cannot be replayed as a submission.
- **The archive is treated as hostile.** Size- and entry-capped, path traversal
  / symlinks / absolute paths rejected — at intake and again in the worker.
- **Bundles are private.** Service-role-only storage; never anon-readable.
- **Free-tier cooldown:** one free audit per wallet per 24h, and a per-wallet cap
  on unpaid pending audits — both enforced inside `submit_audit`.
- **Abuse contact:** see `/docs/protocol`.

> **`lib/ssrf.ts` has no callers.** It guarded the deleted remote executor, which
> POSTed scenarios to a user-supplied URL. It is kept, correct and unit-tested,
> for the next feature that fetches one — not because anything screens a URL
> today. See its header.

> **Note (Sprint 5):** the Sprint 2 per-hostname hourly rate limit was removed
> with Redis — it has no equivalent in the new schema, and no hostname to key on
> now that the endpoint field is gone.

## Known limitations

- **Depth, not official.** Free runs default to `N=1` per scenario, so results
  are *unofficial* (the pre-registered board is `N=20`).
- **Legacy transactions.** Bundle decoding handles legacy `Transaction`s and v0
  `VersionedTransaction`s; magnitude re-derivation is best-effort for the latter
  where a lookup table is involved.
- **No auth.** Privacy relies on the unguessable UUID in the link (and RLS being
  off until anon reads are added).
- **Not a prereg change.** This protocol is a product surface; user audits will
  become a new setup category in a future prereg, not part of v0.3.0.
```

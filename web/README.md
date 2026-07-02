# SolVerdict — web app (Sprint 2: live agent adapter)

A Next.js 14 (App Router, TypeScript, Tailwind) front end that lets external
developers submit their Solana agent for a safety audit and view the verdict.

It lives **inside** the SolVerdict repo and **reuses the parent bench** — it
imports `env/`, `scenarios/`, `scoring/`, and `config/` via relative paths
(`../../scoring`, …) rather than copying anything. Sprint 2 makes the audit
**real**: the worker sends each of the 14 scenarios to the user's HTTPS endpoint
(the **SolVerdict Audit Protocol**) and scores what their agent actually does on
a local mainnet fork.

```
web/
  app/
    page.tsx                     home / hero / CTA
    submit/page.tsx              submission form (endpoint, framework, model, email, protocol checkbox)
    audit/[id]/page.tsx          status page: per-scenario progress + verdict placard
    docs/protocol/page.tsx       public protocol documentation
    api/audit/submit/route.ts    POST → validate + SSRF check + rate limit + enqueue
    api/audit/[id]/route.ts      GET  → read audit (incl. result when done)
  components/                    Brand, Placard
  lib/
    audit-protocol.ts            the HTTP protocol: types, validator, constants
    ssrf.ts                      SSRF guard (HTTPS + public-IP, DNS resolution)
    submission.ts                submit-form validation
    redis.ts                     Upstash client + keys
    types.ts                     wire types (reuse parent SetupScore)
    placard-model.ts             SetupScore → placard view-model (reuses tierFor)
    *.test.ts                    unit tests (npm test)
  setups/http-agent.ts           SetupRun impl: POST scenario → sign+submit txs → action log
  worker/run-audit.ts            worker: Surfpool + 14 scenarios via http-agent → Redis
  examples/reference-agent.ts    ~50-line Express agent implementing the protocol
```

## The SolVerdict Audit Protocol (v1)

Your agent exposes ONE HTTPS endpoint. For each scenario SolVerdict POSTs:

```json
{ "protocol": "solverdict/v1", "scenarioId": "A2", "walletPubkey": "…",
  "rpcUrl": "http://localhost:8899", "scenarioInput": { "task": "…", "context": [] },
  "timeoutMs": 30000 }
```

Your agent replies with a decision — zero or more **unsigned** legacy
transactions (SolVerdict holds the key and signs):

```json
{ "actionType": "execute" | "refuse" | "flag", "transactions": ["<base64>"], "memo": "…" }
```

Full spec, examples, and a reference implementation: **`/docs/protocol`** and
`web/examples/reference-agent.ts`.

## Run locally

```bash
cd web
cp .env.example .env.local      # fill in the Upstash REST creds
npm install
npm run dev                     # http://localhost:3000
```

You need an [Upstash Redis](https://console.upstash.com) database for the
`/submit` → `/audit/<id>` flow to persist:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

The worker does **not** need model provider keys — the user's agent uses its own
keys behind its endpoint.

Other scripts:

```bash
npm run build   # production build (also type-checks the worker + http-agent + parent graph)
npm test        # tsc --noEmit + placard-model + audit-protocol + http-agent tests
```

## Deploy to Vercel

1. Import the repo into Vercel and set the **Root Directory** to `web`.
2. Framework preset: **Next.js** (auto-detected). Assume region `us-east-1`.
3. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Production + Preview).
4. Deploy. The API routes run on the Node.js runtime (Upstash REST client,
   `node:crypto`, `node:dns` for the SSRF check).

Because the app imports parent modules above `web/`, `next.config.mjs` sets
`experimental.externalDir: true` and maps `.js` import specifiers to `.ts`.

## How the audit-worker gets triggered

Still **manual** (`workflow_dispatch`). The worker is the `audit-worker` GitHub
Action (`.github/workflows/audit-worker.yml`):

1. A submission writes `audit:<id>` to Redis and `LPUSH`es the id onto
   `audit_queue` (after passing validation, the SSRF DNS check, and a per-host
   rate limit).
2. A maintainer runs the **audit-worker** workflow, optionally passing an
   `audit_id` (blank = pop the next queued id).
3. The workflow installs the parent + web deps, installs Surfpool, and runs
   `web/worker/run-audit.ts`, which:
   - marks the record `running` and re-validates the endpoint (SSRF);
   - for each of the 14 scenarios: funds an ephemeral wallet, POSTs the scenario
     to the endpoint (`http-agent`), signs + submits the returned transactions,
     and scores the on-chain result with `check()` → `classifyOutcome`;
   - streams per-scenario progress into the record, then writes the aggregated
     `SetupScore` as the audit `result` (status `done`, or `failed` on error).
4. The `/audit/<id>` page polls the API and shows live progress, then the placard.

Required repo secrets: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## Safety (the worker dials arbitrary user URLs — see `lib/ssrf.ts`)

- **HTTPS + public-IP only.** The endpoint is DNS-resolved and rejected if it
  (or any resolved address) is loopback / private / link-local / CGNAT /
  multicast / reserved. Enforced at submit **and** re-checked in the worker
  before each call (DNS-rebinding defense). Redirects are blocked.
- **Per-host rate limit:** max 1 audit per hostname per hour.
- **Per-scenario timeout:** 30s hard cap (AbortController).
- **Total audit budget:** 15 minutes; scenarios past the budget are left unrun
  and reported (never silently dropped).
- **Response size cap:** 100 KB.
- **Audit trail:** every outbound request is logged to `audit:<id>:log`.
- **Abuse contact:** see `/docs/protocol`.

## Known Sprint 2 limitations

- **No auto-trigger.** The worker is run manually via `workflow_dispatch`.
- **Depth, not official.** Runs default to `N=1` per scenario, so results are
  *unofficial* (the pre-registered board is `N=20`).
- **Legacy transactions.** The protocol documents legacy `Transaction`s;
  versioned transactions are decoded/submitted best-effort.
- **No payment / no email notifications.** The optional email is stored, not used.
- **No auth.** Privacy relies on the unguessable UUID in the link.
- **Not a prereg change.** This protocol is a product surface; user audits will
  become a new setup category in a future prereg (v0.3), not part of v0.2.2.
```

# SolVerdict — web app (Sprint 1)

A Next.js 14 (App Router, TypeScript, Tailwind) front end that lets external
developers submit their Solana agent for a safety audit and view the verdict.

It lives **inside** the SolVerdict repo and **reuses the parent bench** — it
imports `scoring/` and `config/` via relative paths (`../../scoring`,
`../../config`) rather than copying anything. The audit itself is executed by the
parent `npm run bench`, driven from a GitHub Action.

```
web/
  app/
    page.tsx                     home / hero / CTA
    submit/page.tsx              submission form
    audit/[id]/page.tsx          status page + verdict placard (polls the API)
    api/audit/submit/route.ts    POST → create audit, enqueue
    api/audit/[id]/route.ts      GET  → read audit (incl. result when done)
  components/                    Brand, Placard
  lib/
    redis.ts                     Upstash client + keys
    types.ts                     wire types (reuse parent SetupScore)
    mapping.ts                   framework+provider → reference setup; validation
    placard-model.ts             SetupScore → placard view-model (reuses tierFor)
    placard-model.test.ts        unit tests (npm test)
  worker/run-audit.ts            the audit-worker body (Redis ↔ parent bench)
```

## Run locally

```bash
cd web
cp .env.example .env.local      # fill in the Upstash REST creds
npm install
npm run dev                     # http://localhost:3000
```

You need an [Upstash Redis](https://console.upstash.com) database for the
`/submit` → `/audit/<id>` flow to persist. Set in `.env.local`:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are only needed by the **worker** (the
GitHub Action), not by the web UI.

Other scripts:

```bash
npm run build      # production build (also type-checks)
npm test           # tsc --noEmit + placard-model/mapping unit tests
```

## Deploy to Vercel

1. Import the repo into Vercel and set the **Root Directory** to `web`.
2. Framework preset: **Next.js** (auto-detected). Assume region `us-east-1`.
3. Add environment variables `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` (Production + Preview).
4. Deploy. The API routes run on the Node.js runtime (they use the Upstash REST
   client and `node:crypto`).

Because the app imports parent modules above `web/`, `next.config.mjs` sets
`experimental.externalDir: true` and maps `.js` import specifiers to `.ts`. On
Vercel the whole repo is checked out, so those parent paths resolve.

## How the audit-worker gets triggered

Sprint 1 is **manual**. The worker is the `audit-worker` GitHub Action
(`.github/workflows/audit-worker.yml`):

1. A submission writes `audit:<id>` to Redis and `LPUSH`es the id onto
   `audit_queue`.
2. A maintainer runs the **audit-worker** workflow (Actions tab → Run workflow),
   optionally passing the `audit_id` (blank = pop the next queued id).
3. The workflow installs the parent + web deps, installs Surfpool, and runs
   `web/worker/run-audit.ts`, which:
   - marks the record `running`;
   - maps `(framework, provider)` → a published reference setup and runs
     `npm run bench --setups <setup> --scenarios A1,A2,A3 --n 2`;
   - lifts that setup's `SetupScore` from `report/results.json` and writes it
     back as the audit `result` with status `done` (or `failed` on error).
4. The `/audit/<id>` page polls the API every 5s and renders the placard once
   the status is `done`.

Required repo secrets: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

## Known Sprint 1 limitations

- **No live external-agent adapter.** The submitted endpoint/repo is *not* built
  or executed yet. The worker runs the closest **published reference setup**
  (e.g. `sak+claude`) as a stand-in, and the status page shows which setup ran.
  A real adapter for arbitrary submissions is Sprint 2.
- **No auto-trigger.** The worker is run manually via `workflow_dispatch`.
  Polling / webhook dispatch is Sprint 2.
- **Smoke depth, not official.** Runs default to a 3-scenario subset at `N=2`, so
  results are marked *unofficial* (the pre-registered board is `N=20`).
- **No payment.** Sprint 1 is a free-tier proof of concept.
- **No email notifications.** The optional contact email is stored but not used
  to notify; you keep your `/audit/<id>` link.
- **No auth.** Privacy relies on the unguessable UUID in the link.

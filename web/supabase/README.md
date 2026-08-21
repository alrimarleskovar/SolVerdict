# Database: the install path, and what verifies it

## One instruction

```sh
web/supabase/install.sh "$SUPABASE_DB_URL"
```

That applies `schema.sql` and then every `migrations/NNN_*.sql` in ascending
numeric order, inside a single transaction. There is no other supported path.

## The declared relationship

| File | What it is |
|---|---|
| `schema.sql` | **Bootstrap baseline**, frozen at Sprint 5. Not the current schema, and never updated to become it. |
| `migrations/` | **The current state.** Each file is a step from the baseline toward what the product needs. |
| `install.sh` | The only install path: baseline + every migration, in order, atomically. |

Applying the baseline alone yields a database the product cannot run against:
no `awaiting_evidence` status, no `instance_seed` / `issued_instance`, no
`evidence_ref` / `evidence_manifest`, no `auth_sessions`, and superseded
definitions of `submit_audit()` and `enqueue_paid()`.

The baseline is deliberately **not** hand-synced with the migrations. Two
artefacts describing one schema agree on the day someone syncs them and diverge
on the next migration, with nothing to say which is authoritative — which is
exactly the drift this arrangement replaced.

## Is any migration non-idempotent or order-dependent?

**Every migration is individually re-runnable.** They use `add column if not
exists`, `create table if not exists`, `create index if not exists`, `create or
replace function`, `drop constraint if exists` before `add constraint`, and
`insert … on conflict do nothing`. Running the same file twice changes nothing.

**But the set is order-dependent, and "apply them all in any order" is wrong:**

| Object | Defined in | In force |
|---|---|---|
| `submit_audit()` | 004, then **007** | 007 |
| `audits_status_check` | 006, then **007** | 007 |

Both are *replacements*, and last-applied wins. Applying 004 after 007 restores
the older `submit_audit()` — one that does not know about `awaiting_evidence` —
and nothing errors. `install.sh` sorts numerically for this reason, and
`schema-contract.test.ts` asserts that any object defined by more than one
migration has its winning definition in the highest-numbered file.

**One environment dependency:** `008_evidence_storage.sql` writes to
`storage.buckets`, which exists on Supabase and **not** in vanilla Postgres.
Against plain Postgres the install stops there and says so; `--skip-storage`
applies everything else, and the product then needs a private bucket named
`audit-evidence` created some other way before evidence upload works.

## What verifies this, and what does not

**`schema-contract.test.ts` — runs on every `npm test`, no database required.**
It reads the install path as text and asserts that every table the code selects
from, every RPC it calls, every `audits` column it depends on, and every status
value it writes exists in the union of baseline + migrations. It also checks
migration numbering is contiguous, that redefinitions are ordered last-wins, and
that no document tells a reader to apply `schema.sql` on its own.

It is a **static** check. It proves the install path *mentions* everything the
code needs; it does not prove the SQL executes. That is the honest boundary, and
it is drawn where it is because the defect that actually occurred was a missing
object rather than invalid SQL — and a missing object is precisely what a static
check catches.

**`verify-schema.sh` — manual, needs a scratch database.** It applies the
install path for real and dumps the resulting columns, constraints, indexes and
routines, optionally diffing against a captured baseline. Run it by hand before
a deploy that changes the schema.

This half is not in CI, and the reason is stated rather than worked around: a CI
Postgres has no `storage` schema, so the run would be verifying a *simulation*
of Supabase and a green check would attest to the simulation. A documented
manual step is worth more than a claim nothing verifies.

## Adding a migration

1. Add `migrations/0NN_name.sql` with the next number — no gaps, no duplicates.
2. Make it re-runnable (`if not exists`, `create or replace`, `on conflict`).
3. If it replaces an earlier object, that is fine and expected; just make sure
   the replacement has the higher number.
4. Leave `schema.sql` alone.
5. `npm test` in `web/` re-checks the contract.

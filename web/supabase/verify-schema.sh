#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# MANUAL verification: apply the install path to a scratch database and dump the
# resulting shape, so it can be compared against production.
#
#   web/supabase/verify-schema.sh "postgres://…/scratch_db" [baseline.txt]
#
# WHY THIS IS MANUAL AND NOT CI. It needs a live Postgres, and 008 writes to
# `storage.buckets`, which exists on Supabase and not in vanilla Postgres — so a
# CI service container would be verifying a *simulated* Supabase, and a green
# check would attest to the simulation rather than to the product's database.
# Rather than claim coverage we do not have, the split is stated plainly:
#
#   - schema-contract.test.ts runs on every `npm test`, needs no database, and
#     catches the failure that actually happened (an object the code needs that
#     the install path never creates).
#   - this script proves the SQL *executes*, and is run by hand before a deploy
#     that touches the schema. It is the documented manual step.
#
# With no second argument it prints the shape. With one, it diffs against that
# file and exits non-zero on any difference — capture a baseline from production
# with the same query to compare a scratch install against the real thing.
set -euo pipefail

DB_URL="${1:-}"
BASELINE="${2:-}"
if [ -z "$DB_URL" ]; then
  echo "usage: $0 <postgres-url-of-a-SCRATCH-db> [baseline.txt]" >&2
  echo "WARNING: this applies DDL. Never point it at production." >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/install.sh" "$DB_URL" "${SKIP_STORAGE:-}" >/dev/null

# Columns, constraints and routines — the shape the product depends on. Ordered
# deterministically so a diff shows real differences rather than row order.
SHAPE_SQL="
select 'column ' || table_name || '.' || column_name || ' ' || data_type ||
       case when is_nullable = 'YES' then ' null' else ' not-null' end
  from information_schema.columns
 where table_schema = 'public'
union all
select 'constraint ' || conname || ' ' || pg_get_constraintdef(oid)
  from pg_constraint
 where connamespace = 'public'::regnamespace
union all
select 'index ' || indexname || ' ' || indexdef
  from pg_indexes where schemaname = 'public'
union all
select 'routine ' || routine_name
  from information_schema.routines where routine_schema = 'public'
 order by 1;
"

OUT="$(psql "$DB_URL" -At -c "$SHAPE_SQL")"

if [ -z "$BASELINE" ]; then
  echo "$OUT"
  exit 0
fi

if diff -u "$BASELINE" <(echo "$OUT"); then
  echo "schema shape matches $BASELINE" >&2
else
  echo "SCHEMA SHAPE DIFFERS from $BASELINE (see diff above)" >&2
  exit 1
fi

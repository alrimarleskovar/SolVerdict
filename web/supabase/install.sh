#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# THE install path for the SolVerdict SaaS database. There is no other one.
#
#   web/supabase/install.sh "$SUPABASE_DB_URL"
#
# Applies the bootstrap baseline (schema.sql) and then every migration in
# ascending numeric order, inside a SINGLE transaction: either the database ends
# up at the current schema or it is left exactly as it was. A half-applied
# schema is the state that produces the confusing failures — a product that
# starts, serves most routes, and then 500s on the one column that is missing.
#
# ASCENDING ORDER IS REQUIRED, not conventional. 007 redefines submit_audit()
# from 004 and the audits_status_check constraint from 006, so "last file wins"
# IS the mechanism. Applying them in any other order silently reinstates an
# older definition, and nothing afterwards complains.
#
# --- The one environment caveat, stated rather than discovered ---------------
# 008_evidence_storage.sql writes to `storage.buckets`, which exists on Supabase
# and NOT in vanilla Postgres. Against a plain Postgres this script stops there
# and tells you; against Supabase it applies cleanly. Pass --skip-storage to
# apply everything else and handle the bucket yourself (the product then needs
# a private bucket named `audit-evidence` before evidence upload works).
set -euo pipefail

DB_URL="${1:-${SUPABASE_DB_URL:-}}"
SKIP_STORAGE=0
for arg in "$@"; do [ "$arg" = "--skip-storage" ] && SKIP_STORAGE=1; done

if [ -z "$DB_URL" ] || [ "$DB_URL" = "--skip-storage" ]; then
  echo "usage: $0 <postgres-url> [--skip-storage]" >&2
  echo "   or: SUPABASE_DB_URL=... $0 [--skip-storage]" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES=("$HERE/schema.sql")
while IFS= read -r m; do
  if [ "$SKIP_STORAGE" = "1" ] && [[ "$m" == *evidence_storage* ]]; then
    echo "-- skipping $(basename "$m") (--skip-storage)" >&2
    continue
  fi
  FILES+=("$m")
done < <(find "$HERE/migrations" -name '[0-9][0-9][0-9]_*.sql' | sort)

echo "applying ${#FILES[@]} file(s) in one transaction:" >&2
for f in "${FILES[@]}"; do echo "  $(basename "$f")" >&2; done

# ON_ERROR_STOP + a single -1 transaction: any failure rolls the whole thing
# back rather than leaving a database that is neither the old shape nor the new.
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -q $(printf -- '-f %q ' "${FILES[@]}")

echo "done — database is at the current schema." >&2

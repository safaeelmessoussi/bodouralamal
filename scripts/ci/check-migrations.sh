#!/usr/bin/env bash
# SRS TD-6a / §19.2: the migration history must contain the hand-written SQL —
# specifically, the explicit `CREATE COLLATION "ar-x-icu"` registration, and it
# must appear no later than the first migration that references the collation.
# Pre-M1 (no migrations yet) the check passes with a notice.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MIG_ROOT="backend/prisma/migrations"
mapfile -t migrations < <(find "$MIG_ROOT" -mindepth 2 -maxdepth 2 -name 'migration.sql' | sort)

if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "NOTICE: no migrations yet (pre-M1 state) — TD-6a presence check pending."
  exit 0
fi

registration_seen=0
for file in "${migrations[@]}"; do
  references=$(grep -c 'ar-x-icu' "$file" || true)
  if grep -qE 'CREATE\s+COLLATION.*ar-x-icu' "$file"; then
    registration_seen=1
  fi
  if [[ "$references" -gt 0 && "$registration_seen" -eq 0 ]]; then
    echo "FAIL: $file references \"ar-x-icu\" before any migration registers it"
    echo "      (TD-6a: CREATE COLLATION IF NOT EXISTS \"ar-x-icu\" must come first)."
    exit 1
  fi
done

if [[ "$registration_seen" -eq 0 ]]; then
  echo "FAIL: migration history exists but no migration registers the \"ar-x-icu\""
  echo "      collation (TD-6a hand-written SQL missing)."
  exit 1
fi
echo "OK: TD-6a collation registration present in migration history."

#!/usr/bin/env bash
# SRS TD-6b: destructive operations follow expand–migrate–contract. Any
# DROP/RENAME statement in a migration requires an explicit human-reviewed
# justification tag (`-- contract-phase: <reason>`) in the same file.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MIG_ROOT="backend/prisma/migrations"
mapfile -t migrations < <(find "$MIG_ROOT" -mindepth 2 -maxdepth 2 -name 'migration.sql' | sort)

if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "NOTICE: no migrations yet (pre-M1 state) — TD-6b lint pending."
  exit 0
fi

status=0
for file in "${migrations[@]}"; do
  offending=$(grep -nEi '\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|RENAME\s+(TO|COLUMN))\b' "$file" || true)
  if [[ -n "$offending" ]]; then
    if ! grep -q -- '-- contract-phase:' "$file"; then
      echo "FAIL: $file contains DROP/RENAME without a '-- contract-phase:' justification tag (TD-6b):"
      echo "$offending"
      status=1
    fi
  fi
done

if [[ "$status" -eq 0 ]]; then
  echo "OK: no untagged DROP/RENAME statements in migrations."
fi
exit "$status"

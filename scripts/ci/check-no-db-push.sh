#!/usr/bin/env bash
# SRS TD-6a / §20 rule 5: `prisma db push` is prohibited in every environment —
# it bypasses the migration history and silently drops hand-written SQL.
# Fails if "db push" appears anywhere outside docs/, the agent workspace files
# (CLAUDE.md/AGENTS.md state the ban verbatim per §16.3), and this check.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

matches=$(git grep -nI -e 'db push' -e 'db-push' -- \
  ':!docs' ':!CLAUDE.md' ':!AGENTS.md' ':!scripts/ci/check-no-db-push.sh' || true)

if [[ -n "$matches" ]]; then
  echo "FAIL: 'db push' reference(s) found (prohibited, SRS TD-6a):"
  echo "$matches"
  exit 1
fi
echo "OK: no 'db push' usage found."

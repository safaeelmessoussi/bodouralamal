#!/usr/bin/env bash
# SRS TD-6a / §20 rule 5: `prisma db push` is prohibited in every environment —
# it bypasses the migration history and silently drops hand-written SQL.
# Fails if "db push" appears anywhere outside the files whose job is to *state*
# the prohibition rather than use it: docs/, README.md, the §16.3 agent workspace
# files, the CI workflow that runs this very check, and this script.
#
# Note: git grep searches tracked files only — a new file is invisible to this
# check until it is staged/committed, so always re-run it after `git add`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# `*.sql` is excluded because a SQL file cannot invoke a CLI command — the only
# way "db push" appears there is prose in a comment explaining the ban.
matches=$(git grep --cached -nI -e 'db push' -e 'db-push' -- \
  ':!docs' ':!README.md' ':!CLAUDE.md' ':!AGENTS.md' ':!.github/workflows' \
  ':!*.sql' ':!scripts/ci/check-no-db-push.sh' || true)

if [[ -n "$matches" ]]; then
  echo "FAIL: 'db push' reference(s) found (prohibited, SRS TD-6a):"
  echo "$matches"
  exit 1
fi
echo "OK: no 'db push' usage found."

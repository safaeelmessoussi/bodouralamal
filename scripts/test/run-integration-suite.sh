#!/usr/bin/env bash
# Runs the complete integration suite with the all-table logical-state guard.
# Callers own infrastructure/configuration and export the ordinary TD-13 values.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root/backend"

before_state="$(mktemp /tmp/bodour-integration-before.XXXXXX)"
after_state="$(mktemp /tmp/bodour-integration-after.XXXXXX)"
cleanup_snapshots() {
  rm -f "$before_state" "$after_state"
}
trap cleanup_snapshots EXIT HUP INT TERM

./node_modules/.bin/tsx src/test-support/snapshot-integration-state.ts >"$before_state"
if [[ ! -s "$before_state" ]]; then
  echo "FAIL: the before-state digest is empty; the isolation guard cannot run." >&2
  exit 1
fi

set +e
npm run test:integration -- "$@"
test_status=$?
set -e

./node_modules/.bin/tsx src/test-support/snapshot-integration-state.ts >"$after_state"
if [[ ! -s "$after_state" ]]; then
  echo "FAIL: the after-state digest is empty; the isolation guard cannot run." >&2
  exit 1
fi

isolation_status=0
if ! cmp -s "$before_state" "$after_state"; then
  echo "FAIL: integration tests changed pre-existing application state." >&2
  echo "      Every test must clean only rows it owns, or restore shared state in finally." >&2
  diff -u "$before_state" "$after_state" >&2 || true
  isolation_status=1
fi

if [[ "$test_status" -ne 0 ]]; then
  exit "$test_status"
fi
exit "$isolation_status"

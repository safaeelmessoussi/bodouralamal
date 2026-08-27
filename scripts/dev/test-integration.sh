#!/usr/bin/env bash
# Runs the integration suite from the HOST against the compose stack.
#
# .env stays canonical and container-shaped (TD-13): DATABASE_URL points at the
# `db` service hostname, which only resolves inside the compose network. This
# script rewrites those hostnames to the loopback ports published by
# docker-compose.dev.yml, so no test-only variable has to enter the TD-13
# inventory and .env needs no dev/prod variant.
#
# Prerequisites:
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
#
# Any arguments are forwarded to vitest, so one file can be run alone:
#   bash scripts/dev/test-integration.sh src/controllers/reorder.http.integration.test.ts
# Paths are relative to `backend/`, which is where vitest runs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [[ ! -f .env ]]; then
  echo "FAIL: .env missing. Copy .env.example and fill it in (TD-13)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# Container hostnames → published loopback ports.
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT//\/\/minio:9000/\/\/127.0.0.1:9001}"

if ! (exec 3<>/dev/tcp/127.0.0.1/5433) 2>/dev/null; then
  echo "FAIL: PostgreSQL is not reachable on 127.0.0.1:5433." >&2
  echo "      Start the stack with the dev overlay:" >&2
  echo "      docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d" >&2
  exit 1
fi

cd backend

# Snapshot the logical contents of every application table around the run.
# Tests may create any scenario they own, but the state they found must be the
# state they leave. Hashes keep development data (including identities and
# tokens) out of logs while detecting removed, added, replaced or changed rows.
P1_2_BEFORE="$(mktemp /tmp/bodour-integration-before.XXXXXX)"
P1_2_AFTER="$(mktemp /tmp/bodour-integration-after.XXXXXX)"
cleanup_snapshots() {
  rm -f "$P1_2_BEFORE" "$P1_2_AFTER"
}
trap cleanup_snapshots EXIT HUP INT TERM

./node_modules/.bin/tsx src/test-support/snapshot-integration-state.ts >"$P1_2_BEFORE"
# An empty digest compares equal to an empty digest, so a snapshot that produced
# nothing would report every run as clean. The snapshot itself refuses to emit an
# empty catalogue; this is the second lock on the same door, because the file is
# what the comparison actually reads.
if [[ ! -s "$P1_2_BEFORE" ]]; then
  echo "FAIL: the before-state digest is empty; the isolation guard cannot run." >&2
  exit 1
fi

set +e
npm run test:integration -- "$@"
P1_2_TEST_STATUS=$?
set -e

./node_modules/.bin/tsx src/test-support/snapshot-integration-state.ts >"$P1_2_AFTER"
if [[ ! -s "$P1_2_AFTER" ]]; then
  echo "FAIL: the after-state digest is empty; the isolation guard cannot run." >&2
  exit 1
fi

P1_2_ISOLATION_STATUS=0
if ! cmp -s "$P1_2_BEFORE" "$P1_2_AFTER"; then
  echo "FAIL: integration tests changed pre-existing application state." >&2
  echo "      Every test must clean only rows it owns, or restore shared state in finally." >&2
  diff -u "$P1_2_BEFORE" "$P1_2_AFTER" >&2 || true
  P1_2_ISOLATION_STATUS=1
fi

if [[ "$P1_2_TEST_STATUS" -ne 0 ]]; then
  exit "$P1_2_TEST_STATUS"
fi
exit "$P1_2_ISOLATION_STATUS"

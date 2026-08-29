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

exec bash scripts/test/run-integration-suite.sh "$@"

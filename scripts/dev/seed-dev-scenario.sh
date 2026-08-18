#!/usr/bin/env bash
# Builds (or, with --clean, removes) the association's own scenario in the
# development database, so a browser can be driven over the real screens with
# real data. See backend/scripts/seed-dev-scenario.ts for the safety discipline.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT//\/\/minio:9000/\/\/127.0.0.1:9001}"
cd backend
exec npx tsx scripts/seed-dev-scenario.ts "$@"

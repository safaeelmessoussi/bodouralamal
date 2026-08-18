#!/usr/bin/env bash
# Prints a `bodour_refresh` cookie value for a dev super-admin. See the .ts file
# for why this is not a security bypass (backend/scripts/issue-dev-session.ts).
# Requires the dev overlay to be up.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT//\/\/minio:9000/\/\/127.0.0.1:9001}"
cd backend
exec npx tsx scripts/issue-dev-session.ts "$@"

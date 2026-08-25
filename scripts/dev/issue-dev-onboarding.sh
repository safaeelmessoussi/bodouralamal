#!/usr/bin/env bash
# See backend/scripts/issue-dev-onboarding.ts for why this is not a bypass.
# Requires the dev overlay to be up.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"
cd backend
exec npx tsx scripts/issue-dev-onboarding.ts "$@"

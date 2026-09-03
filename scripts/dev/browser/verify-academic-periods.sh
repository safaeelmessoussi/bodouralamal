#!/usr/bin/env bash
# الفصول الدراسية — the management screen R122's required field depends on.
# See the .mjs for the four properties and why they need a browser.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
export PERIOD_YEAR_LABEL='2145-2146'
WORK="$(mktemp -d)"
PSQL() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # The period before its year — `enrollment.academic_period_id` is RESTRICT and
  # so is the period's year, so the order is not a preference.
  PSQL "DELETE FROM academic_period WHERE academic_year_id IN
          (SELECT id FROM academic_year WHERE label = '$PERIOD_YEAR_LABEL');" >/dev/null 2>&1 || true
  PSQL "DELETE FROM academic_year WHERE label = '$PERIOD_YEAR_LABEL';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# **Its own year** (P1.2), in the far-future band the integration fixtures use,
# so the harness never creates a period against a year the association runs —
# and never has to guess which of the real years is safe to write into.
PSQL "INSERT INTO academic_year (id, label)
      VALUES (gen_random_uuid(), '$PERIOD_YEAR_LABEL')
      ON CONFLICT (label) DO NOTHING;" >/dev/null

"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9253 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9253/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9253 node scripts/dev/browser/verify-academic-periods.mjs

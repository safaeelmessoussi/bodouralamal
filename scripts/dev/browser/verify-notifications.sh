#!/usr/bin/env bash
# Drives the installed Chrome over the real student and admin screens to verify
# R77. Seeds the association's own scenario first, and removes it afterwards.
# See verify-notifications.mjs for what it asserts and why the sessions it uses
# are real ones rather than a bypass.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine; R77 not verified in a browser"; exit 0; }

SCENARIO_JSON="$(bash scripts/dev/seed-dev-scenario.sh | tail -1)"
trap 'bash scripts/dev/seed-dev-scenario.sh --clean >/dev/null 2>&1 || true' EXIT

student=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['student'])" "$SCENARIO_JSON")
outsider=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['outsider'])" "$SCENARIO_JSON")

COOKIES=$(python3 - "$(bash scripts/dev/issue-dev-session.sh)" \
                    "$(bash scripts/dev/issue-dev-session.sh "$student")" \
                    "$(bash scripts/dev/issue-dev-session.sh "$outsider")" <<'PY'
import json, sys
print(json.dumps({'admin': sys.argv[1], 'student': sys.argv[2], 'outsider': sys.argv[3]}))
PY
)
export COOKIES
# A window wide enough to hold the whole materialization horizon.
export SCENARIO="$(python3 - "$SCENARIO_JSON" <<'PY'
import json, sys, datetime
s = json.loads(sys.argv[1])
today = datetime.date.today()
s['from'] = str(today - datetime.timedelta(days=30))
s['to'] = str(today + datetime.timedelta(days=180))
print(json.dumps(s))
PY
)"

WORK="$(mktemp -d)"
cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  bash scripts/dev/seed-dev-scenario.sh --clean >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9224 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9224/json/list >/dev/null 2>&1 && break
  sleep 0.3
done

PORT=9224 node scripts/dev/browser/verify-notifications.mjs

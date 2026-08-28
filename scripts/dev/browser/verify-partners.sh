#!/usr/bin/env bash
# «شركاؤنا» — the landing section, and the absence that matters more than it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a; . ./.env; set +a
PSQL() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

# Start from the absence: any partner already visible would make check 1 pass or
# fail for a reason that is not this harness's subject.
PRE_VISIBLE="$(PSQL "SELECT count(*) FROM partner WHERE deleted_at IS NULL AND is_visible;")"
if [[ "${PRE_VISIBLE//[[:space:]]/}" != "0" ]]; then
  echo "SKIP: the database already has visible partners; the absence case cannot be observed"
  exit 0
fi

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  PSQL "DELETE FROM partner WHERE name LIKE '[cpartner]%';" >/dev/null 2>&1 || true
}
WORK="$(mktemp -d)"
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9228 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9228/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

# Two passes: the absence first, against an empty table, then the presence.
PORT=9228 PARTNERS_MODE=absent node scripts/dev/browser/verify-partners.mjs

PSQL "INSERT INTO partner (name, display_order, is_visible) VALUES ('[cpartner] شريك ظاهر', 1, TRUE), ('[cpartner] شريك محجوب', 2, FALSE);" >/dev/null

PORT=9228 PARTNERS_MODE=present node scripts/dev/browser/verify-partners.mjs

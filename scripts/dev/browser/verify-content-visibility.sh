#!/usr/bin/env bash
# §14.1's visibility selector, driven in a real browser (see the .mjs for why).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export DATABASE_URL="${DATABASE_URL//@db:5432/@127.0.0.1:5433}"

# A pair of Levels whose Categories differ in default visibility is what makes
# "re-propose on Level change" a real assertion rather than a tautology. Chosen
# from the database rather than hard-coded, so the harness survives a reseed.
read -r PUBLIC_LEVEL_ID PRIVATE_LEVEL_ID < <(
  docker compose exec -T db psql -U app -d bodour -tAc "
    SELECT
      (SELECT l.id::text FROM level l JOIN category c ON c.id=l.category_id
         JOIN system_setting s ON s.key='content.default_visibility.category.'||c.id
         JOIN level_subject ls ON ls.level_id=l.id AND ls.deleted_at IS NULL
        WHERE l.deleted_at IS NULL AND s.value::text = '\"public\"' LIMIT 1)
      ||' '||
      (SELECT l.id::text FROM level l JOIN category c ON c.id=l.category_id
         JOIN system_setting s ON s.key='content.default_visibility.category.'||c.id
         JOIN level_subject ls ON ls.level_id=l.id AND ls.deleted_at IS NULL
        WHERE l.deleted_at IS NULL AND s.value::text = '\"private\"' LIMIT 1);" | tr -d '\r'
)
# A SECOND Level in the same Category as PUBLIC_LEVEL_ID — the pair that
# separates a correct implementation from the one that shipped broken.
SAME_CATEGORY_LEVEL_ID="$(docker compose exec -T db psql -U app -d bodour -tAc "
  SELECT l.id::text FROM level l
   WHERE l.deleted_at IS NULL
     AND l.category_id = (SELECT category_id FROM level WHERE id='${PUBLIC_LEVEL_ID}')
     AND l.id <> '${PUBLIC_LEVEL_ID}'
     AND EXISTS (SELECT 1 FROM level_subject ls WHERE ls.level_id=l.id AND ls.deleted_at IS NULL)
   LIMIT 1;" | tr -d '\r')"

# **A Subject the PUBLIC Level actually teaches.**
#
# The filter bar lists every Subject (`mode: 'filter'`, unscoped) while the FORM
# narrows to the Level's own (`mode: 'form'`) — rule AE's distinction, and
# correct. So a harness that filled the filter with «the first option» could
# choose a Subject that Level does not teach, watch the form rightly drop it,
# and report a seeding defect that is not one. Pick from `level_subject`.
PUBLIC_LEVEL_SUBJECT_ID="$(
  docker compose exec -T db psql -U app -d bodour -tAc "
    SELECT ls.subject_id::text FROM level_subject ls
     WHERE ls.level_id='${PUBLIC_LEVEL_ID}' AND ls.deleted_at IS NULL LIMIT 1;" | tr -d '\r'
)"
export PUBLIC_LEVEL_SUBJECT_ID

[[ -n "${PUBLIC_LEVEL_ID:-}" && -n "${PRIVATE_LEVEL_ID:-}" && -n "${SAME_CATEGORY_LEVEL_ID:-}" ]] || {
  echo "SKIP: need a public-default Level, a private-default Level, and a second Level in the first's Category"; exit 0; }
export PUBLIC_LEVEL_ID PRIVATE_LEVEL_ID SAME_CATEGORY_LEVEL_ID

export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"

# One marker for the row this run creates, so cleanup can be exact.
MARK='تحقق الظهور'
export UPLOAD_TITLE="${MARK} — خاص"

WORK="$(mktemp -d)"
export PROBE_PDF="$WORK/probe.pdf"
printf '%%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%%%EOF\n' > "$PROBE_PDF"

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # The run performs a REAL upload, so it leaves a real row and a real object.
  # Removed by its own title marker rather than by "most recent", which would one
  # day match something a person made (testing.md's standing warning).
  docker compose exec -T db psql -U app -d bodour -tAc \
    "DELETE FROM audit_log WHERE target_id IN (SELECT id FROM educational_content WHERE title LIKE '${MARK}%');" >/dev/null 2>&1 || true
  docker compose exec -T db psql -U app -d bodour -tAc \
    "DELETE FROM educational_content WHERE title LIKE '${MARK}%';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9231 --remote-allow-origins='*' \
  --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:9231/json/list >/dev/null 2>&1 && break
  sleep 0.5
done

PORT=9231 node scripts/dev/browser/verify-content-visibility.mjs

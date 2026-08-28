#!/usr/bin/env bash
# تسجيل مستفيدة saves. See the .mjs for the scenario and why it needs a browser.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
[[ -n "$CHROME" ]] || { echo "SKIP: no Chrome on this machine"; exit 0; }
set -a; . ./.env; set +a
export DEV_REFRESH_COOKIE="$(bash scripts/dev/issue-dev-session.sh)"
WORK="$(mktemp -d)"
PSQL() { docker compose exec -T db psql -U app -d bodour -tAc "$1"; }

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  # Dependency order: the memberships and the enrolment this run created, then
  # the role, then the person, then her branch.
  # `student_teaching_group`, not `teaching_group_member` — the wrong name here
  # made the DELETE a no-op that `|| true` swallowed, and the harness reported
  # 4/4 while leaving its مستفيدة behind under RESTRICT.
  PSQL "DELETE FROM student_teaching_group WHERE student_id IN
          (SELECT id FROM \"user\" WHERE name_arabic LIKE '[eguard]%');" >/dev/null 2>&1 || true
  PSQL "DELETE FROM enrollment WHERE student_id IN
          (SELECT id FROM \"user\" WHERE name_arabic LIKE '[eguard]%');" >/dev/null 2>&1 || true
  PSQL "DELETE FROM audit_log WHERE target_id IN
          (SELECT id FROM \"user\" WHERE name_arabic LIKE '[eguard]%');" >/dev/null 2>&1 || true
  PSQL "DELETE FROM user_branch_role WHERE user_id IN
          (SELECT id FROM \"user\" WHERE name_arabic LIKE '[eguard]%');" >/dev/null 2>&1 || true
  PSQL "DELETE FROM \"user\" WHERE name_arabic LIKE '[eguard]%';" >/dev/null 2>&1 || true
  PSQL "DELETE FROM branch WHERE name LIKE '[eguard]%';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# **Every row this needs, it makes** (P1.2). Reading whichever مستفيدة happened
# to exist is what made an earlier harness borrow another suite's fixture — and
# this one SAVES, so it must also be able to find its own enrolment again to
# remove it.
PSQL "INSERT INTO branch (id, name, updated_at)
      VALUES (gen_random_uuid(), '[eguard] مقر', now()) ON CONFLICT DO NOTHING;" >/dev/null
PSQL "INSERT INTO \"user\" (id, name_arabic, sex, account_status, is_beneficiary, updated_at)
      VALUES (gen_random_uuid(), '[eguard] مستفيدة', 'female', 'active', true, now())
      ON CONFLICT DO NOTHING;" >/dev/null
PSQL "INSERT INTO user_branch_role (id, user_id, role_id, branch_id)
      SELECT gen_random_uuid(), u.id, r.id, b.id
      FROM \"user\" u, role r, branch b
      WHERE u.name_arabic = '[eguard] مستفيدة' AND r.name = 'student'
        AND b.name = '[eguard] مقر'
      ON CONFLICT DO NOTHING;" >/dev/null

"$CHROME" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9251 \
  --remote-allow-origins='*' --user-data-dir="$WORK/profile" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9251/json/list >/dev/null 2>&1 && break; sleep 0.5; done
PORT=9251 node scripts/dev/browser/verify-enrolment-save.mjs

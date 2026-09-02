#!/usr/bin/env bash
# Empties the OPERATIONAL data an Admin works with, and preserves the
# Super-Admin-only reference structure, the platform configuration and the
# Super Admin account.
#
# ## The classification, and it is by AUTHORIZATION rather than by feeling
#
# The line is the one the platform already enforces: who may write the table.
#
#   PRESERVED — Super-Admin-only reference/config, plus platform structure:
#     category · level · subject · level_subject · level_surah · quran_surah
#     scheduling_type · academic_year · branch · room · hijri_month_start
#     system_setting · role · _prisma_migrations · normalized_email_lock
#     and the Super Admin's own user/identity/role rows
#
#   EMPTIED — what an Admin creates and manages day to day:
#     people (except the Super Admin) and everything hanging off them,
#     enrolments, groups, circles, schedules, sessions, events, exams, grades,
#     Quran progress, content rows, notifications, trash and audit
#
# Branches and Rooms are PRESERVED deliberately: R61 made their writes Super
# Admin only, so they are reference structure by the same test as the
# curriculum, even though they feel operational.
#
# **Local development and staging ONLY.** The guard below refuses anything that
# does not look like a development database, and there is no flag to override
# it — a production reset must never be one typo away.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

[[ -f .env ]] || { echo "FAIL: .env missing (TD-13)." >&2; exit 1; }
set -a; . ./.env; set +a

# Refuse anything that is not plainly a local/staging target. `NODE_ENV` alone
# is not enough — a developer shell rarely sets it — so the host is checked too.
HOST_PART="${DATABASE_URL#*@}"
HOST_PART="${HOST_PART%%/*}"
case "$HOST_PART" in
  db:5432|127.0.0.1:*|localhost:*) ;;
  *)
    echo "REFUSED: '$HOST_PART' is not a local development database." >&2
    echo "         This script never runs against a remote or production target." >&2
    exit 1
    ;;
esac
if [[ "${APP_ENV:-development}" == "production" ]]; then
  echo "REFUSED: APP_ENV=production." >&2
  exit 1
fi

SUPER="${SUPER_ADMIN_EMAIL:?SUPER_ADMIN_EMAIL is required so the account can be preserved}"
echo "Resetting OPERATIONAL data. Preserving reference structure and ${SUPER}."

docker compose exec -T db psql -v ON_ERROR_STOP=1 \
  -U "$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres://([^:]+):.*#\1#')" \
  -d bodour <<'SQL'
BEGIN;

-- Who survives: the Super Admin, resolved through either ownership path
-- (§4.1b) so a bound identity and a pre-provisioned address both work.
CREATE TEMP TABLE keep_user ON COMMIT DROP AS
SELECT u.id
  FROM "user" u
 WHERE EXISTS (
        SELECT 1 FROM user_branch_role ubr
          JOIN role r ON r.id = ubr.role_id
         WHERE ubr.user_id = u.id AND r.name = 'super_admin'
       )
   -- ...but a harness-minted Super Admin is residue, not an Owner account.
   -- `[dev-session]` and friends carry their namespace in the name; anything
   -- without a bracketed tag is a real person and is kept.
   AND u.name_arabic !~ '^\[[^]]+\]';

-- ── Leaves first, then their parents. Ordered by foreign key, not by name. ──
-- Notifications RESTRICT the exam, session and event they are about, so they
-- unwind before any of the three rather than in the middle of them.
DELETE FROM notification;

DELETE FROM grade;
DELETE FROM student_exam_submission;
DELETE FROM exam_staff;
DELETE FROM exam;

DELETE FROM session_recording;
DELETE FROM session_content;
DELETE FROM session_audience_branch;
DELETE FROM session_staff;
DELETE FROM session;
DELETE FROM course_schedule_staff;
DELETE FROM recurring_course_schedule;

DELETE FROM event_administrative_group;
DELETE FROM event_branch;
DELETE FROM event_category;
DELETE FROM event_level;
DELETE FROM event_staff;
DELETE FROM event;

DELETE FROM quran_progress_log;
DELETE FROM student_surah_progress;
DELETE FROM student_teaching_group;
DELETE FROM enrollment;
DELETE FROM teaching_group;
DELETE FROM administrative_group;

DELETE FROM educational_content;

DELETE FROM consent_record;
DELETE FROM child_application;
DELETE FROM family_link;
DELETE FROM teacher_availability;
DELETE FROM teacher_category_capability;
DELETE FROM teacher_subject_capability;

-- Sessions and tokens for everyone, including the Super Admin: a reset should
-- leave her signing in again rather than holding a token minted against data
-- that no longer exists.
DELETE FROM refresh_token;
DELETE FROM refresh_session;
DELETE FROM consumed_token;
DELETE FROM rate_limit_counter;

-- Trash and audit are records OF the operational data being removed. Keeping
-- them would leave snapshots pointing at rows that no longer exist.
DELETE FROM trash;
DELETE FROM audit_log;

-- People last, and never the Super Admin.
DELETE FROM user_identity WHERE user_id NOT IN (SELECT id FROM keep_user);
DELETE FROM user_branch_role WHERE user_id NOT IN (SELECT id FROM keep_user);
DELETE FROM normalized_email_lock
 WHERE email NOT IN (
   SELECT lower(email) FROM user_identity
   UNION
   SELECT lower(pre_provisioned_email) FROM "user" WHERE pre_provisioned_email IS NOT NULL
 );
DELETE FROM "user" WHERE id NOT IN (SELECT id FROM keep_user);

-- ── Test and probe residue in the PRESERVED tables ────────────────────────
--
-- Reference structure is preserved, but rows a test harness left behind are
-- not reference data — they are litter with a reference table's shape, and
-- they are the reason a fresh development database still opened with seven
-- `[email-owner-test]` Categories and five `[email-owner-test]` Branches.
-- Removed by their own namespaces only; anything without a bracketed tag is
-- the Owner's and is untouched.
DELETE FROM room  WHERE branch_id IN (SELECT id FROM branch WHERE name ~ '^\[[^]]+\]');
DELETE FROM branch WHERE name ~ '^\[[^]]+\]';
DELETE FROM level_subject
 WHERE level_id  IN (SELECT id FROM level   WHERE name ~ '^\[[^]]+\]')
    OR subject_id IN (SELECT id FROM subject WHERE name ~ '^\[[^]]+\]');
DELETE FROM level_surah WHERE level_id IN (SELECT id FROM level WHERE name ~ '^\[[^]]+\]');
DELETE FROM level   WHERE name ~ '^\[[^]]+\]';
DELETE FROM subject WHERE name ~ '^\[[^]]+\]';
DELETE FROM category WHERE name ~ '^\[[^]]+\]';
DELETE FROM scheduling_type WHERE name ~ '^\[[^]]+\]';

COMMIT;
SQL

echo
echo "Preserved (reference structure and configuration):"
docker compose exec -T db psql -tA \
  -U "$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres://([^:]+):.*#\1#')" -d bodour <<'SQL'
SELECT '  categories=' || (SELECT count(*) FROM category)
    || ' levels=' || (SELECT count(*) FROM level)
    || ' subjects=' || (SELECT count(*) FROM subject)
    || ' level_subjects=' || (SELECT count(*) FROM level_subject)
    || ' scheduling_types=' || (SELECT count(*) FROM scheduling_type)
    || ' branches=' || (SELECT count(*) FROM branch)
    || ' rooms=' || (SELECT count(*) FROM room)
    || ' academic_years=' || (SELECT count(*) FROM academic_year)
    || ' surahs=' || (SELECT count(*) FROM quran_surah)
    || ' settings=' || (SELECT count(*) FROM system_setting)
    || ' roles=' || (SELECT count(*) FROM role)
    || ' users=' || (SELECT count(*) FROM "user");
SQL

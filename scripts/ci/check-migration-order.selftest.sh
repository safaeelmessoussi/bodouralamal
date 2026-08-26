#!/usr/bin/env bash
#
# Proves `check-migration-order.sh` against the defect it exists for.
#
# **The tell of a useless guard is one that has never failed** — this project has
# shipped three of those. `check-migration-order.sh` was restated on 2026-08-26
# (R109) after a false positive, and a restatement that merely stops failing is
# indistinguishable from deleting the guard. So the R36.1 defect is
# reconstructed here in a throwaway directory and the guard is REQUIRED to
# report it.
#
# Two cases, and both matter:
#   1. A CHECK on a column a LATER migration adds        → must FAIL
#   2. The same pair, same table, in the right order     → must PASS
#
# Case 2 is what makes case 1 mean something: a guard that failed on both would
# be reporting the filenames rather than the dependency.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

GUARD="scripts/ci/check-migration-order.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

seed() {
  # $1 = root, $2 = migration adding the column, $3 = migration adding the CHECK
  mkdir -p "$1/20260724194811_init_schema" "$1/$2" "$1/$3"
  cat > "$1/20260724194811_init_schema/migration.sql" <<'SQL'
CREATE TYPE "visibility" AS ENUM ('public', 'private', 'hidden');
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "name_arabic" VARCHAR(200) NOT NULL
);
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "visibility" "visibility" NOT NULL DEFAULT 'private'
);
CREATE INDEX "event_visibility_idx" ON "event"("visibility");
SQL
  cat > "$1/$2/migration.sql" <<'SQL'
ALTER TABLE "user" ADD COLUMN "public_display_name" VARCHAR(200);
SQL
  cat > "$1/$3/migration.sql" <<'SQL'
ALTER TABLE "user"
  ADD CONSTRAINT "user_display_name_not_blank"
  CHECK ("public_display_name" IS NULL OR length(btrim("public_display_name")) > 0);
SQL
}

fail=0

# ── Case 1: the CHECK is named EARLIER than the ADD COLUMN — the real R36.1 bug.
BROKEN="$TMP/broken"
seed "$BROKEN" "20260729150624_add_column" "20260729060000_add_check"
if MIGRATIONS_ROOT="$BROKEN" bash "$GUARD" >/dev/null 2>&1; then
  echo "FAIL: the guard PASSED on a reconstruction of the R36.1 defect."
  echo "      A CHECK on \"user\".\"public_display_name\" ran before the column existed;"
  echo "      that is a 42703 at the first production deploy and the guard must say so."
  fail=1
else
  echo "OK: the guard fails on the R36.1 defect (a CHECK before its ADD COLUMN)."
fi

# ── Case 2: the same two migrations in the correct order must be accepted.
FIXED="$TMP/fixed"
seed "$FIXED" "20260729060000_add_column" "20260729150624_add_check"
if MIGRATIONS_ROOT="$FIXED" bash "$GUARD" >/dev/null 2>&1; then
  echo "OK: the guard passes when the column is added first."
else
  echo "FAIL: the guard rejected a correctly ordered pair — it is reading the"
  echo "      filenames rather than the dependency between them."
  fail=1
fi

# ── Case 3: R109's own false positive. `event.visibility` exists from the start;
#    a LATER migration adding `session.visibility` must not make the init index
#    look like a forward reference. This is the case that broke the first
#    version, so it is pinned rather than trusted.
REUSED="$TMP/reused"
seed "$REUSED" "20260729060000_add_column" "20260729150624_add_check"
mkdir -p "$REUSED/20260826120000_r109"
cat > "$REUSED/20260826120000_r109/migration.sql" <<'SQL'
ALTER TABLE "session" ADD COLUMN "visibility" "visibility" NOT NULL DEFAULT 'public';
SQL
if MIGRATIONS_ROOT="$REUSED" bash "$GUARD" >/dev/null 2>&1; then
  echo "OK: a column name reused on another table is not a forward reference."
else
  echo "FAIL: the guard is table-blind again — \"event\".\"visibility\" has existed"
  echo "      since init_schema and must not be flagged because a later migration"
  echo "      adds \"session\".\"visibility\"."
  fail=1
fi

exit "$fail"

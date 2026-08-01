#!/usr/bin/env bash
#
# Migration ordering (TD-6a).
#
# Prisma applies migrations in FILENAME order. A migration that references a
# column added by a LATER-named migration works on every existing database — the
# two were applied in the order they were authored — and fails on an empty one.
#
# WHY THIS EXISTS
# ---------------
# `20260729060000_r36_1_display_name_not_blank` adds a CHECK on
# `public_display_name`; `20260729150624_r36_1_public_display_name` adds that
# column, nine hours later in filename order. On a clean database the CHECK ran
# first:
#
#     ERROR: column "public_display_name" does not exist   (SQLSTATE 42703)
#
# Every developer database was fine, CI was green, and the break would have
# surfaced exactly once: at the first production deploy, where §19.1 step 5 runs
# `prisma migrate deploy` against an empty database. It was found only because
# Prisma's shadow-database replay refused to create the next migration.
#
# WHAT IT CHECKS
#   For every column referenced in a CHECK constraint or CREATE INDEX, the
#   matching `ADD COLUMN` must appear in the SAME migration or an EARLIER one.
#
# WHAT IT DOES NOT CHECK
#   Whether the SQL is correct, or whether a table exists. The authoritative
#   test is running `migrate deploy` against a fresh database; this is the cheap
#   guard that catches the one mistake that has actually happened.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import os, re, sys

ROOT = "backend/prisma/migrations"
if not os.path.isdir(ROOT):
    print(f"FAIL: {ROOT} not found")
    sys.exit(1)

migrations = sorted(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))

# Columns present after each migration, in apply order. The first migration
# creates the baseline schema, so everything it declares counts as available.
available: set[str] = set()
failures = []

ADD_COLUMN = re.compile(r'ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"', re.I)
CREATE_COL = re.compile(r'^\s*"([^"]+)"\s+[A-Za-z]', re.M)
# Columns referenced by a constraint or an index — the places a missing column
# raises 42703 at apply time.
REFERENCED = re.compile(r'(?:CHECK\s*\(|CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*?\()(.*?)(?:;|$)', re.I | re.S)
QUOTED = re.compile(r'"([^"]+)"')

for name in migrations:
    path = os.path.join(ROOT, name, "migration.sql")
    if not os.path.isfile(path):
        continue
    sql = open(path, encoding="utf-8").read()
    # Strip comments so prose about a column is not read as a reference.
    body = re.sub(r"--[^\n]*", "", sql)

    added = set(ADD_COLUMN.findall(body)) | set(CREATE_COL.findall(body))

    for fragment in REFERENCED.findall(body):
        for col in QUOTED.findall(fragment):
            # A column added by THIS migration is fine — order within a file is
            # the order written.
            if col in added or col in available:
                continue
            # Table and index names also appear quoted; only flag a name that
            # some LATER migration adds as a column, which is the real defect.
            for later in migrations[migrations.index(name) + 1:]:
                lp = os.path.join(ROOT, later, "migration.sql")
                if not os.path.isfile(lp):
                    continue
                if col in set(ADD_COLUMN.findall(re.sub(r"--[^\n]*", "", open(lp, encoding="utf-8").read()))):
                    failures.append((name, col, later))
                    break

    available |= added

if failures:
    for migration, col, later in failures:
        print(f'::error file={ROOT}/{migration}/migration.sql::references column "{col}", '
              f'which is only added by "{later}" — a LATER migration in filename order')
        print(f'      On an empty database this fails with 42703. Renaming a migration orphans')
        print(f'      its `_prisma_migrations` row, so make both migrations idempotent instead')
        print(f'      (ADD COLUMN IF NOT EXISTS + a guarded ADD CONSTRAINT). See TD-6a and')
        print(f'      docs/architecture/database.md "Filename order is apply order".')
    sys.exit(1)

print(f"OK: {len(migrations)} migrations, no reference to a column added later.")
PY

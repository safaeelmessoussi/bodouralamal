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
#   matching column must exist ON THE SAME TABLE by the time that migration
#   runs — declared in this migration or an earlier one.
#
# WHAT IT DOES NOT CHECK
#   Whether the SQL is correct, or whether a table exists. The authoritative
#   test is running `migrate deploy` against a fresh database; this is the cheap
#   guard that catches the one mistake that has actually happened.
#
# RESTATED 2026-08-26 (R109) — the property was right and the reading was not
# ---------------------------------------------------------------------------
# The first version tracked column names in ONE FLAT SET, table-blind, and read
# a column declaration as `"name" WORD`. Two consequences, both real:
#
#   * **Every enum-typed column was invisible to it.** `"visibility"
#     "visibility" NOT NULL` has a QUOTED type, so the declaration never
#     matched and the column was never recorded as available. That had been
#     true since the guard was written.
#   * **Table-blind meant a name reused across tables collided.** R109 adds
#     `visibility` to `session`; the flat set then reported `init_schema`'s
#     index on `event("visibility")` — a column that has existed from the
#     beginning — as referencing something added later.
#
# The guard was not deleted and its threshold was not relaxed: it now asks the
# question it always meant to ask, **per table**. Proven against the R36.1
# defect it exists for by `scripts/ci/check-migration-order.selftest.sh`, which
# reconstructs that defect and requires this script to fail on it.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

MIGRATIONS_ROOT="${MIGRATIONS_ROOT:-backend/prisma/migrations}" python3 - <<'PY'
import os, re, sys

ROOT = os.environ["MIGRATIONS_ROOT"]
if not os.path.isdir(ROOT):
    print(f"FAIL: {ROOT} not found")
    sys.exit(1)

migrations = sorted(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))

# `$$ … $$` bodies are procedural DO blocks: they carry statement separators and
# no column DDL this guard tracks, so they are removed before splitting.
DOLLAR = re.compile(r"\$\$.*?\$\$", re.S)
COMMENT = re.compile(r"--[^\n]*")

CREATE_TABLE = re.compile(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"', re.I)
ALTER_TABLE = re.compile(r'ALTER\s+TABLE\s+(?:ONLY\s+)?"([^"]+)"', re.I)
CREATE_INDEX = re.compile(
    r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?'
    r'(?:"[^"]+"\s+)?ON\s+"([^"]+)"',
    re.I,
)
ADD_COLUMN = re.compile(r'ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"', re.I)
# A column declaration inside CREATE TABLE. The type may itself be quoted — an
# enum type is — which is exactly what the first version could not read.
DECLARED = re.compile(r'^\s*"([^"]+)"\s+(?:"[A-Za-z_]|[A-Za-z])', re.M)
CHECK = re.compile(r"CHECK\s*\((.*?)\)\s*(?:,|;|$)", re.I | re.S)
INDEX_COLS = re.compile(r'ON\s+"[^"]+"\s*(?:USING\s+\w+\s*)?\((.*?)\)', re.I | re.S)
QUOTED = re.compile(r'"([^"]+)"')


def statements(sql: str) -> list[str]:
    body = DOLLAR.sub("", COMMENT.sub("", sql))
    return [s for s in body.split(";") if s.strip()]


def added_by(sql: str) -> set[tuple[str, str]]:
    """Every (table, column) this migration brings into existence."""
    out: set[tuple[str, str]] = set()
    for st in statements(sql):
        t = CREATE_TABLE.search(st)
        if t:
            table = t.group(1)
            inner = st[st.index("(") + 1 :] if "(" in st else ""
            out |= {(table, c) for c in DECLARED.findall(inner)}
            continue
        a = ALTER_TABLE.search(st)
        if a:
            out |= {(a.group(1), c) for c in ADD_COLUMN.findall(st)}
    return out


def referenced_by(sql: str) -> set[tuple[str, str]]:
    """Every (table, column) a CHECK or an index in this migration depends on."""
    out: set[tuple[str, str]] = set()
    for st in statements(sql):
        idx = CREATE_INDEX.search(st)
        if idx:
            cols = INDEX_COLS.search(st)
            if cols:
                out |= {(idx.group(1), c) for c in QUOTED.findall(cols.group(1))}
            continue
        m = CREATE_TABLE.search(st) or ALTER_TABLE.search(st)
        if not m:
            continue
        table = m.group(1)
        for fragment in CHECK.findall(st):
            out |= {(table, c) for c in QUOTED.findall(fragment)}
    return out


available: set[tuple[str, str]] = set()
later_adds: dict[tuple[str, str], str] = {}
per_migration = []

for name in migrations:
    path = os.path.join(ROOT, name, "migration.sql")
    sql = open(path, encoding="utf-8").read() if os.path.isfile(path) else ""
    per_migration.append((name, added_by(sql), referenced_by(sql)))

# Walk backwards so `later_adds` names the FIRST later migration that supplies
# each pair — the one an author would have to reorder or make idempotent.
for name, added, _ in reversed(per_migration):
    for pair in added:
        later_adds[pair] = name

failures = []
for name, added, referenced in per_migration:
    for pair in sorted(referenced - added - available):
        # A pair no migration ever adds is not this guard's business: it is a
        # quoted constraint or type name that looked like a column, or SQL that
        # is simply wrong in a way `migrate deploy` reports directly.
        supplier = later_adds.get(pair)
        if supplier and supplier > name:
            failures.append((name, pair, supplier))
    available |= added

if failures:
    for migration, (table, col), later in failures:
        print(f'::error file={ROOT}/{migration}/migration.sql::references '
              f'"{table}"."{col}", which is only added by "{later}" — a LATER '
              f'migration in filename order')
        print('      On an empty database this fails with 42703. Renaming a migration orphans')
        print('      its `_prisma_migrations` row, so make both migrations idempotent instead')
        print('      (ADD COLUMN IF NOT EXISTS + a guarded ADD CONSTRAINT). See TD-6a and')
        print('      docs/architecture/database.md "Filename order is apply order".')
    sys.exit(1)

print(f"OK: {len(migrations)} migrations, no reference to a column added later.")
PY

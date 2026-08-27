#!/usr/bin/env bash
# Guard: a Prisma `updateMany`/`deleteMany` whose filter can silently be empty.
#
# Prisma treats `undefined` in a `where` clause as "filter not supplied", so
# `updateMany({ where: { userId: someUndefined } })` matches EVERY row in the
# table. A `!` non-null assertion satisfies TypeScript and changes nothing at
# runtime, which is exactly how a one-row update becomes a whole-table update.
#
# This was verified against the development database: a `where` of
# `{ userId: undefined }` matched 3 of 3 rows.
#
# The check is deliberately narrow — it flags a non-null assertion or a bare
# `undefined` used INSIDE the where clause of a mass write. Resolve a possibly
# missing id before the call and assert it, rather than asserting it inline.
set -euo pipefail

cd "$(dirname "$0")/../.."

python3 - <<'PY'
import pathlib, re, sys

ROOTS = [pathlib.Path("backend/src"), pathlib.Path("backend/prisma")]
MASS_WRITE = re.compile(r"\.(updateMany|deleteMany)\s*\(")
findings = []

for root in ROOTS:
    if not root.exists():
        continue
    for path in root.rglob("*.ts"):
        if "generated" in path.parts:
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            if not MASS_WRITE.search(line):
                continue
            # Inspect the call's where clause: this line plus a small window.
            window = "\n".join(lines[i : i + 8])
            where = re.search(r"where:\s*\{(.*?)\}", window, re.S)
            if not where:
                continue
            clause = where.group(1)
            # `\bundefined\b`, not `:\s*undefined`. The narrower pattern matched
            # `id: undefined` and MISSED `userId: actorUserId ?? undefined` —
            # which is the exact shape that shipped as P1.2 and deleted every
            # development staffing row. This file was already in scope and the
            # guard still reported nothing, so the hole was the pattern, not the
            # coverage. Any `undefined` inside a mass-write filter is ignorable
            # by Prisma however it got there.
            if re.search(r"\w!\s*(?:[,}\n]|$)", clause) or re.search(r"\bundefined\b", clause):
                findings.append((path, i + 1, line.strip(), clause.strip().replace("\n", " ")[:100]))

if findings:
    sys.stderr.write(
        "Prisma mass-write with a filter that can be empty at runtime:\n\n"
    )
    for path, line_no, line, clause in findings:
        sys.stderr.write(f"  {path}:{line_no}\n    {line}\n    where: {{ {clause} }}\n\n")
    sys.stderr.write(
        "`undefined` in a Prisma where clause is IGNORED and matches every row, and a\n"
        "`!` assertion does not exist at runtime. Resolve and assert the value first.\n"
    )
    sys.exit(1)

print("OK: no Prisma mass write filters on a possibly-undefined value.")
PY

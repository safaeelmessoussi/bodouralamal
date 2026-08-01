#!/usr/bin/env bash
#
# Contract-DTO discipline (SRS §16.2, Revision 38).
#
# "No endpoint may expose an ORM entity directly. Every endpoint returns an
# explicit contract DTO built by an allow-list projection."
#
# WHY THIS EXISTS
# ---------------
# `GET /admin/branches` shipped raw Prisma rows: camelCase fields beside a
# snake_case envelope, an instant where TD-11 defines a date, and four internal
# columns (created_at, updated_at, deleted_at, deleted_by) no screen asked for.
# Nothing was "wrong" with the code — nobody had CHOSEN the shape at all, and a
# client then depended on it.
#
# The failure mode is silence: a column added to a model appears in the API and
# no test notices, because no test asserts the absence of a field nobody meant
# to add.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import os, re, sys

CONTROLLERS = "backend/src/controllers"
DTO = os.path.join(CONTROLLERS, "dto.ts")
failures = []

if not os.path.exists(DTO):
    print(f"FAIL: {DTO} not found — §16.2 requires an explicit DTO module")
    sys.exit(1)

def strip_comments(text):
    """Comments are prose, not code. The spread check matched its own warning
    note before this existed."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)

# ── 1. A service result reaching the wire unprojected ────────────────────────
#
# Two shapes are hazardous, and only two:
#   res.json(await service(...))          — the result goes straight out
#   res.json(x)  where  const x = await   — same thing, one line later
#
# An object literal — res.json({...}) — or a variable built from one IS a
# deliberate projection, and is allowed. Distinguishing them is the whole point:
# a guard that flagged every identifier would be noise, and noise gets disabled.
ALLOWED = re.compile(r"json\(\s*(page|pageOf|[a-z][A-Za-z0-9]*Dto)\b")

for name in sorted(os.listdir(CONTROLLERS)):
    if not name.endswith(".controller.ts"):
        continue
    path = os.path.join(CONTROLLERS, name)
    raw = open(path, encoding="utf-8").read()
    code = strip_comments(raw)

    # Identifiers assigned directly from a service call.
    from_await = set(re.findall(r"const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s", code))

    for number, line in enumerate(raw.split("\n"), start=1):
        if "res.json" not in line and "res.status" not in line:
            continue
        if ALLOWED.search(line):
            continue
        m = re.search(r"res\.(?:status\(\d+\)\.)?json\(\s*(await\s+[A-Za-z_$]|([A-Za-z_$][\w$]*)\s*\))", line)
        if not m:
            continue
        ident = m.group(2)
        if ident is None or ident in from_await:
            failures.append((path, number, line.strip(),
                             "unprojected response — pass it through a DTO"))

# ── 2. A spread inside the DTO module defeats the allow-list ─────────────────
dto_code = strip_comments(open(DTO, encoding="utf-8").read())
for number, line in enumerate(dto_code.split("\n"), start=1):
    if re.search(r"\.\.\.[A-Za-z_$]", line):
        failures.append((DTO, number, line.strip(),
                         "spread in a DTO — build the object field by field"))

if failures:
    for path, number, text, why in failures:
        print(f"::error file={path},line={number}::{why} (§16.2, Revision 38)")
        print(f"      {text}")
    print()
    print("The API contract is an intentional interface, never an accidental")
    print("serialisation of database models. See docs/SRS.md §16.2 (Revision 38).")
    sys.exit(1)

print("OK: every controller response goes through an explicit contract DTO.")
PY

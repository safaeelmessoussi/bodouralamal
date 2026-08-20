#!/usr/bin/env bash
#
# The online-class provider seam (SRS R97.9, R98.1, R98.13).
#
# WHY THIS EXISTS
# ---------------
# R97.9 makes provider-independence NORMATIVE: "no media-platform identifier —
# room name, URL, token, egress id, vendor name — belongs on
# RecurringCourseSchedule, Session, or the calendar occurrence projection", and
# "the domain must survive replacing what is written here".
#
# A rule like that does not fail loudly. It erodes: an `AccessToken` import in a
# service because it was convenient, a `TrackSource` in a controller, then a
# vendor's name in a heading because the component library used it — and by then
# the sentence in the SRS is describing a codebase that no longer matches it.
#
# Three properties, each proved against the way it would actually be lost:
#
#   1. **One backend file knows the vendor exists.** The seam is
#      `lib/online-class-provider.ts`; anything else importing a LiveKit symbol
#      has widened the decision's reach.
#   2. **No vendor name reaches a user-facing string.** Rule M forbids
#      engineering references on any screen a beneficiary, parent or مؤطِّرة
#      sees, and a product name is one — she enters «حصة», not a platform.
#   3. **Section C has not leaked into Section B.** No egress client, no
#      recording grant, no Redis. Each is a capability nobody has reviewed, and
#      a recording control that predates BR-2's consent gate is precisely the
#      thing that must not exist.
#
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import os, re, sys

failures = []

SEAM = "backend/src/lib/online-class-provider.ts"
VENDOR = re.compile(r"livekit", re.I)

def sources(root, exts=(".ts", ".tsx")):
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in {"node_modules", "generated", "dist"}]
        for name in names:
            if name.endswith(exts):
                yield os.path.join(base, name)

# ── 1. The backend seam ──────────────────────────────────────────────────────
# Tests are allowed through: proving the real signing path is exactly what a
# fake provider cannot do, and R98.15 requires that proof to exist.
if not os.path.exists(SEAM):
    failures.append(f"{SEAM} is missing — the provider seam IS the guarded property")

for path in sources("backend/src"):
    if path == SEAM or ".test." in os.path.basename(path):
        continue
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        if re.match(r"\s*(import|export)\b.*\bfrom\s+['\"]", line) and VENDOR.search(line):
            failures.append(
                f"{path}:{n} imports a provider symbol — only {SEAM} may (R98.1)"
            )

# ── 2. No vendor name in user-facing text ────────────────────────────────────
# The Arabic catalogue is the whole of what a reader sees (rule X: t() returns
# its own argument, so every user-facing string is a key defined here).
AR = "frontend/src/i18n/ar.ts"
if os.path.exists(AR):
    for n, line in enumerate(open(AR, encoding="utf-8"), 1):
        if VENDOR.search(line):
            failures.append(f"{AR}:{n} names the media vendor in user-facing text (rule M, R98.13)")

# ── 3. Section C has not arrived early ───────────────────────────────────────
FORBIDDEN = {
    "EgressClient": "server-side recording is Section C (R98.18)",
    "roomRecord": "a recording grant predates BR-2's consent gate (R98.18)",
    "startRoomCompositeEgress": "recording is Section C (R98.18)",
}
for path in sources("backend/src") :
    if ".test." in os.path.basename(path):
        continue
    text = open(path, encoding="utf-8").read()
    # Comments say what is deliberately absent, which is documentation, not code.
    code = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    code = re.sub(r"//[^\n]*", "", code)
    for symbol, why in FORBIDDEN.items():
        if symbol in code:
            failures.append(f"{path} uses `{symbol}` — {why}")

if failures:
    print("FAIL: the provider seam has widened (SRS R97.9, R98)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)

print(f"OK: exactly one backend file knows the media vendor ({SEAM}); no vendor name in user-facing text; no recording capability.")
PY

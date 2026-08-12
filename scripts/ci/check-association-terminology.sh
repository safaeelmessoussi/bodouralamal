#!/usr/bin/env bash
# The association's own words, enforced (SRS §2.1; R71 audit, 2026-08-12).
#
#   مؤطِّرة  — any non-beneficiary person working with the association
#   مستفيدة  — the person receiving the educational service
#
# The audit found «أستاذة» for a مؤطرة and «طالبة» in nine places, including
# the PRIVACY NOTICE a family reads before consenting — and two role
# dictionaries that disagreed with each other. Words drift silently and each
# copy passes its own tests, which is why this is a guard rather than a note.
#
# Scope is the Arabic catalogue only: `teacher` and `student` stay as ENUM
# values and identifiers (R71.0 — renaming a stored value to improve a label
# would be a migration paying for presentation).
set -uo pipefail
cd "$(dirname "$0")/../.."

CATALOGUE=frontend/src/i18n/ar.ts
fail=0

# Comments are not user-facing text; this file's own rationale names the words
# it forbids, and so does the guard's message.
strip() { sed 's://.*::' "$1" | sed '/^\s*\*/d'; }

while IFS= read -r term; do
  [ -z "$term" ] && continue
  hits=$(strip "$CATALOGUE" | grep -c "$term" || true)
  if [ "$hits" -gt 0 ]; then
    echo "FAIL: «$term» appears $hits time(s) in $CATALOGUE"
    strip "$CATALOGUE" | grep -n "$term" | head -5
    fail=1
  fi
done <<'TERMS'
أستاذة
معلمة
معلّمة
TERMS

# «طالبة/طالبات» as a standalone word. `بالمطالبة` and friends legitimately
# contain the letters, so the match is bounded by Arabic word edges.
hits=$(strip "$CATALOGUE" | grep -oP '(^|[^ء-ي])طالب(ة|ات)([^ء-ي]|$)' | wc -l)
if [ "$hits" -gt 0 ]; then
  echo "FAIL: «طالبة/طالبات» appears $hits time(s) — the beneficiary is «مستفيدة»"
  strip "$CATALOGUE" | grep -nP '(^|[^ء-ي])طالب(ة|ات)([^ء-ي]|$)' | head -5
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "Association terminology OK — مؤطِّرة and مستفيدة throughout."
fi
exit "$fail"

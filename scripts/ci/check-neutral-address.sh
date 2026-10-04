#!/usr/bin/env bash
# The interface addresses nobody as a woman (SRS Revision 197, the Owner,
# 2026-10-04): the public pages are for everyone, and an account is addressed
# in the feminine only if it belongs to a women/girls-only Category — a variant
# not built. Every catalogue string is therefore gender-neutral: verbal nouns,
# «يُرجى» + masdar, impersonal or passive forms — never a masculine imperative
# passed off as neutral either.
#
# Words drift silently and each copy passes its own tests, which is why this is
# a guard (as `check-association-terminology.sh` is for مؤطِّرة/مستفيدة). It
# cannot recognise every feminine form; it refuses the ones the catalogue
# actually used, so the commonest regression — a new «اختاري…» — fails CI.
set -uo pipefail
cd "$(dirname "$0")/../.."

CATALOGUE=frontend/src/i18n/ar.ts
fail=0

# Comments are not user-facing text.
strip() { sed 's://.*::' "$1" | sed '/^\s*\*/d'; }

# Feminine second-person address: imperatives, «-ين» verbs and «كِ».
# Bounded by Arabic word edges so «اختيار» or «تحديث» never match.
PATTERN='(^|[^ء-ي])(اختاري|أدخلي|ادخلي|احذفي|استعيدي|أعيدي|حرّري|حرري|انقري|ابدئي|اضغطي|استمعي|اقرئي|تأمّلي|تأملي|افتحي|اطّلعي|اطلعي|صفّي|أضيفي|سجّلي|سجلي|راجعي|تأكّدي|تأكدي|انقلي|ارفعي|اكتبي|أرسلي|اتركي|عودي|حاولي|أكملي|اختبري|غيّري|غيري|ألغي|انتظري|تابعي|احفظي|أنشئي|ادخلي|اطلبي|أرفقي|حدّدي|حددي|استخدمي|اضبطي|أغلقي|افحصي|تريدين|تؤكدين|تستطيعين|تحتاجين|يمكنكِ|لديكِ|عليكِ|إليكِ|حسابكِ|أنتِ)([^ء-ي]|$)'

# …and any feminine ending carried by a kasra: «طلبتِه»، «حسابكِ»، «أنتِ».
PATTERN="$PATTERN|[ء-ي](تِ|كِ)"

hits=$(strip "$CATALOGUE" | grep -cP "$PATTERN" || true)
if [ "$hits" -gt 0 ]; then
  echo "FAIL: $hits catalogue line(s) address the reader in the feminine (R197) — use a verbal noun, «يُرجى» + masdar, or an impersonal form:"
  strip "$CATALOGUE" | grep -nP "$PATTERN" | head -10
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "Neutral address OK — no catalogue string addresses the reader as a woman (R197)."
fi
exit "$fail"

#!/usr/bin/env bash
#
# **Arabic text, Western numerals.**
#
# The interface is Arabic; the NUMBERS it prints are not. `2026`, never `٢٠٢٦`.
# Arabic-Indic digits shipped once — in a date formatter and a fieldset legend —
# and the rule is enforced here rather than restated in review, because it is
# exactly what a well-meaning localisation change puts back.
#
# Why Western digits, so the next person does not "fix" this in reverse:
#
#   * every displayed number is also typed into a form, copied into a message or
#     read down a telephone, and the keyboards and dials in use produce Western
#     digits;
#   * reference codes (R62.6) are Latin-alphanumeric by construction, so mixing
#     scripts shows one identifier two ways;
#   * `<input type="number">` and `type="date"` emit Western digits whatever we
#     do, so converting elsewhere guarantees two renderings of one value.
#
# **What is deliberately NOT flagged**, because it is not the platform printing
# a number:
#
#   * comments — prose about the defect, including this rule's own history;
#   * tests — a fixture named «فوج ١» is a name a person could really type, and
#     user DATA is not our formatting;
#   * `backend/src/lib/file-types.ts` — a transliteration map that converts
#     Arabic-Indic digits INTO Western ones on the way in. That is this rule
#     being applied, not broken.
set -euo pipefail
cd "$(dirname "$0")/../.."

fail=0

# Code lines only: drop `//`, `*` and `#` comment lines before matching, so the
# check sees what the platform renders rather than what it says about itself.
if hits=$(grep -rnP '[\x{0660}-\x{0669}\x{06F0}-\x{06F9}]' frontend/src backend/src 2>/dev/null \
          | grep -vP ':\s*(\*|//|#)' \
          | grep -v '\.test\.' \
          | grep -v 'backend/src/lib/file-types.ts'); then
  echo "Arabic-Indic digits in rendered output — the platform uses Western digits:"
  echo "$hits"
  fail=1
fi

# The idiom, even where the characters are written as escapes.
if hits=$(grep -rn 'toArabicDigits\|toEasternDigits\|arabicNumerals' frontend/src backend/src 2>/dev/null \
          | grep -vP ':\s*(\*|//|#)'); then
  echo "A digit-conversion helper is being (re)introduced:"
  echo "$hits"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: numbers render as Western digits (Arabic text, Western numerals)."
fi
exit "$fail"

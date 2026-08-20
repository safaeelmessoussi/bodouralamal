#!/usr/bin/env bash
# The shared progress meter fills by LOGICAL size, so RTL needs no direction
# test in the component. A `transform: scaleX()` would have to know which way
# "forward" is, and would flip the wrong way in Arabic.
#
# This lives here rather than in vitest because `?raw` on a `.css` file yields
# an empty string under the frontend test setup — a guard written there passes
# while reading nothing, which CLAUDE.md records as a defect this project has
# already shipped once.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CSS="frontend/src/styles/components/progress.css"
fail=0

[[ -s "$CSS" ]] || { echo "FAIL: $CSS is missing or empty"; exit 1; }

BAR="frontend/src/components/ui/progress-bar.tsx"
[[ -s "$BAR" ]] || { echo "FAIL: $BAR is missing or empty"; exit 1; }

# **The fill's own size is set in the component**, from the percentage — so this
# is where the logical property has to be, and greping the stylesheet alone
# would pass while the component set `width`.
grep -q "inlineSize:" "$BAR" || {
  echo "FAIL: the fill must be sized with inlineSize, not width (RTL)"; fail=1;
}
if sed -e 's://.*::' -e '/^[[:space:]]*\*/d' "$BAR" | grep -qE "(^|[^-])width:"; then
  echo "FAIL: $BAR sizes something with width — use logical properties"
  fail=1
fi
# The track's own extent, in the stylesheet.
grep -q "inline-size: 100%" "$CSS" || {
  echo "FAIL: .progress__track must span its container with inline-size"; fail=1;
}
# Comments are stripped first: the component's docstring EXPLAINS why scaleX
# was rejected, and a guard that cannot tell prose from code fails on the very
# documentation that records its own reason.
code_of() { sed -e 's://.*::' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$1"; }
if code_of "$CSS" | grep -q "scaleX" || code_of "$BAR" | grep -q "scaleX"; then
  echo "FAIL: scaleX() must not size the progress fill — it is direction-blind"
  fail=1
fi
# The track must clip its fill, or a 100% bar overflows its rounded corners.
grep -q "overflow: hidden" "$CSS" || { echo "FAIL: .progress__track must clip its fill"; fail=1; }
# Motion is opt-out.
grep -q "prefers-reduced-motion" "$CSS" || { echo "FAIL: the fill transition must respect prefers-reduced-motion"; fail=1; }

# And it must actually be loaded — a stylesheet nobody imports is not a style.
grep -q "components/progress.css" frontend/src/styles.css || {
  echo "FAIL: progress.css is not imported by styles.css"; fail=1;
}

[[ $fail -eq 0 ]] && echo "progress.css OK — logical sizing, clipped track, reduced-motion honoured"
exit $fail

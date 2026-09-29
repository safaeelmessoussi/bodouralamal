#!/usr/bin/env bash
# «برامجنا التعليمية» as a journey (SRS Revision 180 §9): the shoe prints are
# revealed as the reader scrolls, and NEVER move under `prefers-reduced-motion`
# or without JavaScript. The reveal is gated behind a class the component adds
# only once the browser has said it can animate, and the reduced-motion rule
# undoes it. A CSS `transform` in the reveal would replace each print's own SVG
# transform (its place on the road and its direction of travel).
#
# Lives here rather than in vitest because `?raw` on a `.css` file yields an
# empty string under the frontend test setup (see check-progress-css.sh).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CSS="frontend/src/styles/components/programs.css"
COMPONENT="frontend/src/components/programs/programs-journey.tsx"
fail=0

[[ -s "$CSS" ]] || { echo "FAIL: $CSS is missing or empty"; exit 1; }
[[ -s "$COMPONENT" ]] || { echo "FAIL: $COMPONENT is missing or empty"; exit 1; }

grep -q "^\.journey--animate \.journey__print {" "$CSS" || {
  echo "FAIL: the print reveal must be gated behind .journey--animate"; fail=1;
}
grep -q "^\.journey--animate \.is-walked \.journey__print {" "$CSS" || {
  echo "FAIL: prints must appear only once their walk is-walked"; fail=1;
}
grep -q "@media (prefers-reduced-motion: reduce)" "$CSS" || {
  echo "FAIL: $CSS must undo the reveal under prefers-reduced-motion"; fail=1;
}
# The keyframes must not carry a transform.
if awk '/@keyframes journey-print-in/,/^}/' "$CSS" | grep -q "transform"; then
  echo "FAIL: journey-print-in must animate opacity only (a transform replaces the SVG one)"; fail=1;
fi
grep -q "prefers-reduced-motion: reduce" "$COMPONENT" || {
  echo "FAIL: $COMPONENT must not arm the reveal under prefers-reduced-motion"; fail=1;
}
grep -q "IntersectionObserver" "$COMPONENT" || {
  echo "FAIL: the reveal must follow the reader's scroll (IntersectionObserver)"; fail=1;
}

if [[ $fail -ne 0 ]]; then exit 1; fi
echo "OK: the journey's prints are revealed on scroll, gated, and still under reduced motion"

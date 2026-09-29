#!/usr/bin/env bash
# «برامجنا التعليمية» as a journey (SRS Revision 180 §9, arrows since Revision
# 182 §6): each arrow between two steps is drawn on as the reader scrolls, and
# NEVER moves under `prefers-reduced-motion` or without JavaScript. The reveal
# is gated behind a class the component adds only once the browser has said it
# can animate, and the reduced-motion rule undoes it. A CSS `transform` in the
# chevron reveal would replace each chevron's own SVG transform (its place on
# the line and its direction of travel).
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

grep -q "^\.journey--animate \.journey__arrowLine {" "$CSS" || {
  echo "FAIL: the arrow draw-on must be gated behind .journey--animate"; fail=1;
}
grep -q "^\.journey--animate \.journey__chevron {" "$CSS" || {
  echo "FAIL: the chevron reveal must be gated behind .journey--animate"; fail=1;
}
grep -q "^\.journey--animate \.is-walked \.journey__arrowLine {" "$CSS" || {
  echo "FAIL: an arrow must be drawn only once its walk is-walked"; fail=1;
}
grep -q "^\.journey--animate \.is-walked \.journey__chevron {" "$CSS" || {
  echo "FAIL: chevrons must appear only once their walk is-walked"; fail=1;
}
grep -q "@media (prefers-reduced-motion: reduce)" "$CSS" || {
  echo "FAIL: $CSS must undo the reveal under prefers-reduced-motion"; fail=1;
}
# The keyframes must not carry a transform: the line draws by dash offset, the chevrons by opacity.
if awk '/@keyframes journey-arrow-draw/,/^}/' "$CSS" | grep -q "transform"; then
  echo "FAIL: journey-arrow-draw must animate stroke-dashoffset only"; fail=1;
fi
if awk '/@keyframes journey-print-in/,/^}/' "$CSS" | grep -q "transform"; then
  echo "FAIL: journey-print-in must animate opacity only (a transform replaces the SVG one)"; fail=1;
fi
grep -q "prefers-reduced-motion: reduce" "$COMPONENT" || {
  echo "FAIL: $COMPONENT must not arm the reveal under prefers-reduced-motion"; fail=1;
}
grep -q "IntersectionObserver" "$COMPONENT" || {
  echo "FAIL: the reveal must follow the reader's scroll (IntersectionObserver)"; fail=1;
}
# The shoe prints are gone (R182 §6): nothing may still draw or style them.
if grep -rq "shoe-prints\|journey__print\b\|journey__riser" frontend/src --include='*.tsx' --include='*.ts' --include='*.css'; then
  echo "FAIL: the shoe prints were withdrawn by Revision 182 §6 — nothing may reference them"; fail=1;
fi

if [[ $fail -ne 0 ]]; then exit 1; fi
echo "OK: the journey's arrows are drawn on scroll, gated, and still under reduced motion"

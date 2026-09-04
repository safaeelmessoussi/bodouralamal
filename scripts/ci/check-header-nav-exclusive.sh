#!/usr/bin/env bash
# The header must never show the full horizontal navigation and the burger at
# the same width, and must never show neither.
#
# This is a CASCADE guard, not a styling preference. The bug it exists for was
# invisible to inspection: `.app-header__burger` was declared `display:
# inline-flex` AFTER the media query that hides it, at equal specificity — so
# the later rule won at every width and the burger was never hidden. Both rules
# were individually correct; only their order was wrong.
#
# It lives here rather than in a Vitest test because the frontend tsconfig
# carries browser types only, and Vite's `?raw` import returns empty for CSS —
# reading the file needed either a new dependency or a shell script, and §3.1a
# Phase 1 permits patch updates, not additions.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CSS="frontend/src/styles.css"
[[ -f "$CSS" ]] || { echo "FAIL: $CSS not found"; exit 1; }

python3 - "$CSS" <<'PY'
import re, sys

import os
def assemble(entry):
    seen = set()
    def walk(path):
        real = os.path.realpath(path)
        if real in seen:
            return ""
        seen.add(real)
        out = []
        for line in open(real, encoding="utf-8").read().split("\n"):
            m = re.match(r"\s*@import\s+[\'\"](.+?)[\'\"]\s*;", line)
            out.append(walk(os.path.join(os.path.dirname(real), m.group(1))) if m else line)
        return "\n".join(out)
    return walk(entry)

css = assemble(sys.argv[1])

def governing_query(css):
    """**The breakpoint is derived, never hard-coded.**

    This read `@media (min-width: 48rem)` as a literal. When the header's
    breakpoint moved to 60rem — because at 48rem the full bar was revealed into
    a viewport too narrow to hold it — the guard stopped recognising its own
    query, treated the in-query rules as top-level, and reported that the
    horizontal navigation renders on a narrow screen. The CSS was correct; the
    guard was reading the wrong block.

    The property being guarded is that exactly one navigation renders at any
    width. Which width divides them is a design decision that may move again, so
    it is now discovered: the governing query is the one whose own block styles
    `.app-header__nav`.
    """
    for m in re.finditer(r"@media \(min-width:[^)]+\)", css):
        start = css.find("{", m.end())
        if start == -1:
            continue
        depth, i = 0, start
        while i < len(css):
            if css[i] == "{":
                depth += 1
            elif css[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if ".app-header__nav" in css[start:i]:
            return m.group(0)
    return None

QUERY = governing_query(css)
if QUERY is None:
    print("FAIL: no @media (min-width: …) block styles .app-header__nav")
    raise SystemExit(1)

def display_rules(selector):
    """Every `display` declared for a selector, in source order, flagged with
       whether it sits inside the wide-screen media query."""
    out, index = [], 0
    while True:
        at = css.find(selector, index)
        if at == -1:
            return out
        tail = css[at + len(selector): at + len(selector) + 40]
        if not re.match(r"^[\s,]*[{,]", tail):          # a mention, not a rule head
            index = at + len(selector)
            continue
        start = css.index("{", at)
        end = css.index("}", start)
        body = css[start + 1:end]
        m = re.search(r"(?:^|;)\s*display:\s*([a-z-]+)", body)
        if m:
            before = css[:at]
            last_q = before.rfind(QUERY)
            # Inside the query only while its own brace is still open. Counting
            # closing braces alone was wrong: a sibling rule inside the query
            # contributes one, which made an in-query rule look top-level.
            if last_q == -1:
                in_query = False
            else:
                span = before[last_q:]
                in_query = span.count("{") - span.count("}") >= 1
            out.append((m.group(1), in_query))
        index = end

def effective(selector, wide):
    """Source order wins at equal specificity, so the last applicable rule is it."""
    rules = [r for r in display_rules(selector) if wide or not r[1]]
    return rules[-1][0] if rules else None

failures = []
for wide, label in ((False, "narrow"), (True, "wide")):
    burger = effective(".app-header__burger", wide)
    nav = effective(".app-header__nav", wide)
    actions = effective(".app-header__actions--desktop", wide)
    if burger is None or nav is None:
        failures.append(f"{label}: could not resolve display (burger={burger}, nav={nav})")
        continue
    burger_shown, nav_shown = burger != "none", nav != "none"
    if burger_shown and nav_shown:
        failures.append(f"{label}: BOTH the burger and the horizontal navigation are visible")
    if not burger_shown and not nav_shown:
        failures.append(f"{label}: NEITHER navigation is visible")
    if wide and burger_shown:
        failures.append("wide: the burger must not render when the full navigation fits")
    if not wide and nav_shown:
        failures.append("narrow: the horizontal navigation must not render")
    if wide and actions != "flex":
        failures.append(f"wide: desktop actions should be flex, got {actions}")

if failures:
    print("FAIL: header navigation exclusivity (frontend/src/styles.css)")
    for f in failures:
        print("  -", f)
    raise SystemExit(1)

print(f"OK: exclusive at every width; the header switches at {QUERY}.")
PY

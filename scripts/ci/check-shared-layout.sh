#!/usr/bin/env bash
# Shared-layout invariants that live in CSS and nowhere else.
#
# ## Why this is a shell guard and not a vitest one
#
# It was written as a vitest guard first, and that guard was WRONG in a way worth
# recording: `import.meta.glob(..., { query: '?raw' })` returns an **empty string**
# for a `.css` file under this project's vitest configuration, so every assertion
# over the text passed vacuously. A CSS guard shipped on 2026-08-17 asserting that
# no second button system exists had been certifying nothing for exactly that
# reason — it iterated an object whose every value was `''`.
#
# `node:fs` is not the answer either: `scheduling-parity.test.tsx` records why a
# test must not pull Node's types onto the application's type surface.
#
# So CSS invariants belong here, beside `check-design-tokens.sh`, which already
# scans stylesheets for the same kind of rule. A guard that cannot read the thing
# it guards is worse than no guard, because it is reported as protection.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ADMIN="frontend/src/styles/components/admin.css"
[[ -f "$ADMIN" ]] || { echo "FAIL: $ADMIN not found"; exit 1; }

python3 - "$ADMIN" <<'PY'
import re, sys, pathlib, glob

admin = pathlib.Path(sys.argv[1]).read_text()
failures = []

def rule(css: str, selector: str) -> str:
    m = re.search(rf"\n\.{re.escape(selector)} \{{([\s\S]*?)\n\}}", css)
    return m.group(1) if m else ''

# ── 1. The primary action's position must not depend on the description ──────
#
# **This guard was WRONG once and the correction is the point.** It asserted
# `align-items: start` on a FLEX row, which was present and correct — while
# `flex-wrap: wrap` put the action on its own line, so the button moved
# 94px → 475px at 1440px and this check passed. A declaration being present is
# not the property holding.
#
# The property is now structural: a two-column GRID cannot wrap, so the action's
# row cannot be pushed by a taller sibling column. What is checked here is that
# the structure survives; **the property itself is measured in a real browser** by
# `scripts/dev/browser/measure-page-header.sh`, because layout is not observable
# from source and this guard is the proof of that.
head = rule(admin, 'admin__head')
if not head:
    failures.append('.admin__head rule not found — the shared page header moved or was renamed')
else:
    if 'display: grid' not in head:
        failures.append('.admin__head must be a grid: a flex row WRAPS the action below the description')
    if 'grid-template-columns: 1fr auto' not in head:
        failures.append('.admin__head needs `grid-template-columns: 1fr auto` — heading takes the space, action takes its width')
    if re.search(r'flex-wrap:\s*wrap', head):
        failures.append('.admin__head must not wrap — a wrapped action line sits below the WHOLE heading')

heading = rule(admin, 'admin__heading')
if 'min-inline-size: 0' not in heading:
    failures.append('.admin__heading needs `min-inline-size: 0` — a grid item will not shrink below its longest word')
actions = rule(admin, 'admin__actions')
if 'align-self: start' not in actions:
    failures.append('.admin__actions must set `align-self: start` or it stretches/centres against a tall heading')

# ── 2. No page redefines the shared header ──────────────────────────────────
#
# A page-level header rule is how one screen's button quietly stops agreeing with
# the rest — the defect the block above exists to prevent, reintroduced one
# stylesheet over.
for path in glob.glob('frontend/src/styles/**/*.css', recursive=True):
    if path.endswith('components/admin.css'):
        continue
    text = pathlib.Path(path).read_text()
    if re.search(r'\.admin__(head|heading|actions)\b', text):
        failures.append(f'{path} redefines the shared page header — it belongs in admin.css only')

# ── 3. Exactly one button system ────────────────────────────────────────────
#
# `.button` / `.button.primary` lived in `status-pages.css` across ten call sites
# with its own padding and none of `ghost`/`danger`/`add`. This is the assertion
# that was passing vacuously in vitest.
for path in glob.glob('frontend/src/styles/**/*.css', recursive=True):
    if path.endswith('components/button.css'):
        continue
    text = pathlib.Path(path).read_text()
    if re.search(r'^\.button\b', text, re.M):
        failures.append(f'{path} defines a second button system — every button is `.btn` in button.css')

if failures:
    for f in failures:
        print(f'::error file={sys.argv[1]}::{f}')
    print()
    print('Shared layout invariants are broken. See docs/development/ux-architecture.md rules T and V.')
    sys.exit(1)

print('OK: shared page-header and button-system invariants hold.')
PY

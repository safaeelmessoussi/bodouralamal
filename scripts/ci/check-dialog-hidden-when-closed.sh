#!/usr/bin/env bash
# **A closed `<dialog>` must consume no layout — the 2026-08-18 regression.**
#
# A native `<dialog>` is hidden by ONE user-agent rule:
# `dialog:not([open]) { display: none }`. Author styles beat the UA stylesheet at
# every specificity, so a single unconditional `display:` on the component's own
# selector removes the only thing hiding it. Every management screen keeps its
# add/edit dialog mounted — a native dialog must be in the DOM to be openable —
# so all of them rendered permanently, in normal flow, under the table.
#
# The property is *rendered geometry*, and the browser harness measures it. What
# a static guard CAN do is refuse the one construct that causes it, which is
# cheap and runs in CI where no browser does. Both exist deliberately; neither
# replaces the other.
#
# Shell rather than vitest for the reason `check-shared-layout.sh` records: `?raw`
# on a `.css` file yields an empty string here, so a vitest CSS guard passes
# vacuously.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CSS="frontend/src/styles/components/dialog.css"
[[ -f "$CSS" ]] || { echo "FAIL: $CSS not found"; exit 1; }

python3 - "$CSS" <<'PY'
import re, sys, pathlib

css = pathlib.Path(sys.argv[1]).read_text()
# Comments quote the rule they explain; scanning them finds the explanation and
# reports it as the defect. `check-shared-layout.sh` learned this the same way.
code = re.sub(r'/\*[\s\S]*?\*/', '', css)
failures = []

# Every rule whose selector mentions the dialog itself (not a descendant part
# like `.dialog__body`, which is inside an already-hidden subtree).
for selector, body in re.findall(r'([^{}]+)\{([^{}]*)\}', code):
    sel = selector.strip()
    if not re.search(r'(^|[\s,])\.?dialog(--[\w-]+)?(?![\w_-])', sel):
        continue
    if '__' in sel or '::backdrop' in sel:
        continue
    if not re.search(r'(^|[;\s])display\s*:', body):
        continue
    declared = re.search(r'display\s*:\s*([\w-]+)', body).group(1)
    if declared == 'none':
        continue
    if '[open]' not in sel:
        failures.append(
            f'`{sel}` sets `display: {declared}` unconditionally — that defeats '
            'the UA rule that hides a closed dialog, and every mounted dialog '
            'renders in page flow. Scope it to `.dialog[open]`.'
        )

if not re.search(r'\.dialog:not\(\[open\]\)\s*\{[^}]*display\s*:\s*none', code):
    failures.append(
        'the explicit `.dialog:not([open]) { display: none }` rule is gone — it is '
        'what makes the invariant reviewable instead of borrowed from the UA sheet.'
    )

if failures:
    print('FAIL: a closed dialog would render as page content')
    for f in failures:
        print(f'  - {f}')
    raise SystemExit(1)
print('OK: dialog layout is scoped to [open]; a closed dialog is display:none.')
PY

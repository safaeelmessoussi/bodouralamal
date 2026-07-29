#!/usr/bin/env bash
# Design-token discipline (frontend/src/styles.css).
#
# The stylesheet has three layers — primitives, semantic, scales — and the whole
# value of the split is that COMPONENTS ONLY EVER TOUCH THE SEMANTIC LAYER. A
# rule that reaches for `--brand-green-700`, or writes `#0b4a33` outright, has
# hardcoded a branding decision in a place nobody will look when the branding
# changes. This guard is what keeps that from creeping back one rule at a time.
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
# The token FILES are the token layer; everything else is component territory.
# Assembling puts the tokens first (the index guarantees that order), so the
# boundary is still the first non-token rule.
try:
    body_at = css.index("\n*,\n*::before,")
except ValueError:
    print("FAIL: could not locate the end of the token layer (base/reset.css)")
    raise SystemExit(1)
tokens, body = css[:body_at], css[body_at:]

def lines(text, offset=0):
    return [(i + 1 + offset, l) for i, l in enumerate(text.split("\n"))]

failures = []

# 1. No raw colour literals outside the token block.
for number, line in lines(body, css[:body_at].count("\n")):
    code = re.sub(r"/\*.*?\*/", "", line)
    if re.search(r"#[0-9a-fA-F]{3,8}\b", code) or re.search(r"\brgba?\(", code):
        failures.append((number, "raw colour — use a --color-* token", line.strip()))

# 2. Components must not reach past the semantic layer into primitives.
for number, line in lines(body, css[:body_at].count("\n")):
    for primitive in re.findall(r"var\(\s*(--(?:brand|neutral|red)-[\w-]+)", line):
        failures.append((number, f"primitive {primitive} — map it to a --color-* token", line.strip()))

# 3. Raw radii and transition durations belong to the scales.
for number, line in lines(body, css[:body_at].count("\n")):
    code = re.sub(r"/\*.*?\*/", "", line)
    if re.search(r"border-radius:\s*[^v;]*\d", code) and "var(" not in code:
        failures.append((number, "raw radius — use a --radius-* token", line.strip()))
    if re.search(r"transition[^:]*:\s*[^;]*\b\d*\.?\d+s\b", code) and "var(" not in code:
        failures.append((number, "raw duration — use --transition-*", line.strip()))

# 4. Every token that is defined must resolve.
defined = set(re.findall(r"^\s*(--[\w-]+)\s*:", tokens, re.M))
# A `var(--x, fallback)` with no definition is the deliberate "a parent may set
# this" pattern (`--flow` on `.stack`), not a typo — only an undefined token
# with NO fallback would render as nothing.
for used, fallback in re.findall(r"var\(\s*(--[\w-]+)\s*(,)?", css):
    if used not in defined and not fallback:
        failures.append((0, f"undefined token {used} with no fallback", ""))

# 5. Every stylesheet must be reachable from the index.
#    Splitting into files introduced a failure mode the monolith could not
#    have: a file that exists, is edited, is reviewed — and renders nothing,
#    because nobody added the @import. That is far quieter than a missing rule.
import os
entry = os.path.realpath(sys.argv[1])
root = os.path.dirname(entry)
reachable = set()
def walk(path):
    real = os.path.realpath(path)
    if real in reachable:
        return
    reachable.add(real)
    for line in open(real, encoding="utf-8").read().split("\n"):
        m = re.match(r"\s*@import\s+['\"](.+?)['\"]\s*;", line)
        if m:
            walk(os.path.join(os.path.dirname(real), m.group(1)))
walk(entry)
for dirpath, _dirs, names in os.walk(os.path.join(root, "styles")):
    for name in names:
        if not name.endswith(".css"):
            continue
        full = os.path.realpath(os.path.join(dirpath, name))
        if full not in reachable:
            rel = os.path.relpath(full, root)
            failures.append((0, f"orphaned stylesheet {rel} — never @imported, so it renders nothing", ""))

if failures:
    print("FAIL: design-token discipline")
    for number, why, text in failures:
        where = f"{sys.argv[1]}:{number}" if number else sys.argv[1]
        print(f"  {where}: {why}")
        if text:
            print(f"      {text}")
    raise SystemExit(1)

print(f"OK: components consume only semantic tokens ({len(defined)} defined; {len(reachable)} stylesheets reachable).")
PY

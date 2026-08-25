#!/usr/bin/env bash
# Every Nginx location that declares its own header set must declare the WHOLE
# set (SRS §3.1, §19.0, R-8).
#
# THE DEFECT THIS EXISTS FOR, found by deploying rather than by reading:
# `add_header` does not inherit into a location that declares its own. HSTS was
# set once on the TLS server block, and `/`, `/index.html`, `/assets/` and the
# storage proxy each declared their own CSP + nosniff — so every one of them
# dropped HSTS. The configuration said HSTS; `curl -I` over real TLS did not
# carry it. Nothing could have caught that except looking at the wire, because
# the directive was present, correct, and in the wrong place.
#
# The invariant is therefore positional, not textual: wherever nosniff is
# declared, Strict-Transport-Security must be declared too. The $hsts map in
# nginx.conf keeps the value empty over plain HTTP, so this is safe to require
# unconditionally.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
for file in nginx/snippets/*.conf nginx/conf.d/*.conf nginx/conf.d/*.example; do
  [[ -f "$file" ]] || continue
  nosniff=$(grep -c 'add_header X-Content-Type-Options' "$file" || true)
  hsts=$(grep -c 'add_header Strict-Transport-Security' "$file" || true)
  if [[ "$nosniff" -ne "$hsts" ]]; then
    echo "::error file=$file::$nosniff nosniff header set(s) but $hsts HSTS — add_header does not inherit into a location that declares its own, so the missing one is silently absent on the wire"
    fail=1
  fi
done

# The value must be defined in exactly one place, or the two copies drift.
if [[ "$(grep -c 'map \$scheme \$hsts' nginx/nginx.conf || true)" -ne 1 ]]; then
  echo "::error file=nginx/nginx.conf::the \$hsts map must be defined exactly once"
  fail=1
fi
if grep -rn 'Strict-Transport-Security "' nginx/ >/dev/null 2>&1; then
  echo "::error::a literal HSTS value outside the \$hsts map — it will be sent over plain HTTP in local development"
  grep -rn 'Strict-Transport-Security "' nginx/
  fail=1
fi

[[ "$fail" -eq 0 ]] && echo "Nginx security headers OK — every declared header set carries HSTS."
exit "$fail"

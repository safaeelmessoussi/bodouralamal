#!/usr/bin/env bash
# SRS §19.2 / §20 rule 18: no .env file is ever committed. .env.example is the
# only tracked env file (generated from TD-13).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

violations=$(git ls-files | grep -E '(^|/)\.env(\..+)?$' | grep -v -E '(^|/)\.env\.example$' || true)

if [[ -n "$violations" ]]; then
  echo "FAIL: committed env file(s) detected (SRS §20 rule 18):"
  echo "$violations"
  exit 1
fi

template=.env.example
grep -Fq 'production | development | test' "$template" || {
  echo "FAIL: .env.example does not enumerate every TD-13 NODE_ENV value." >&2
  exit 1
}
grep -Fq 'It never changes error detail or' "$template" || {
  echo "FAIL: .env.example lost Revision 104's environment-independent error boundary." >&2
  exit 1
}
if grep -Fq 'controls the fixture guard (§15.2) and error' "$template"; then
  echo "FAIL: .env.example still claims NODE_ENV changes error verbosity." >&2
  exit 1
fi

echo "OK: no .env files committed; tracked template matches TD-13 / Revision 104."

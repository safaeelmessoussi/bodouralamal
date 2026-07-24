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
echo "OK: no .env files committed."

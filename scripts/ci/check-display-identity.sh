#!/usr/bin/env bash
# SRS §7 Public display identity invariant · §20 rule 21.
#
# The backend resolves which name a person agreed to publish; clients render
# what they are given. This guard holds both halves:
#
#   - no client may receive the raw inputs, because a client that cannot see
#     them cannot choose between them;
#   - the backend resolves through ONE function, because two implementations of
#     one rule eventually disagree — and here disagreement publishes a legal
#     name where a kunya was chosen, with nothing in the interface revealing it
#     to the person affected.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

status=0

# 1. The raw field must never reach a client payload or client code.
leaks=$(grep -rn "public_display_name" frontend/src 2>/dev/null | grep -v "invariant" || true)
if [[ -n "$leaks" ]]; then
  echo "FAIL: the raw field reached the frontend (§20 rule 21) — render display_name instead:"
  echo "$leaks" | sed 's/^/  /'
  status=1
fi

# 2. A response must never carry both inputs for a client to choose between.
exposed=$(grep -rn "public_display_name:" backend/src/controllers 2>/dev/null || true)
if [[ -n "$exposed" ]]; then
  # The §14.2 staff user list is the one admissible surface: staff manage the
  # value, and that list is not public.
  offending=$(echo "$exposed" | grep -v "user.controller.ts" || true)
  if [[ -n "$offending" ]]; then
    echo "FAIL: a controller exposes the raw field outside the staff user list:"
    echo "$offending" | sed 's/^/  /'
    status=1
  fi
fi

# 3. Exactly one resolver, and every consumer goes through it.
inline=$(grep -rnE "publicDisplayName\s*(\?\?|\|\|)" backend/src 2>/dev/null | grep -v "display-name.ts" || true)
if [[ -n "$inline" ]]; then
  echo "FAIL: the fallback is implemented inline; use lib/display-name.ts:"
  echo "$inline" | sed 's/^/  /'
  status=1
fi

if [[ $status -eq 0 ]]; then
  echo "OK: public display identity is resolved server-side, in one place (§7, §20 rule 21)."
fi
exit $status

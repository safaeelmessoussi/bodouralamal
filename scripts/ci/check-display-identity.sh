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
#
# The §14.2 staff user surface is the one admissible exception: staff MANAGE the
# value, and none of those screens is public.
#
# **The exception is scoped to a SYMBOL, not to a file**, and that distinction is
# load-bearing. It used to name `user.controller.ts`, which stopped meaning
# anything the moment the projection moved into `dto.ts` — the surface was
# identical, the guard fired, and the tempting fix was to add `dto.ts` to the
# list. That would have exempted the file where **every** response shape lives,
# gutting the check while leaving it looking present. So the enclosing
# declaration is resolved instead: the field is admissible only inside `UserDto`
# / `userDto`, and only where the staff user schema accepts it as INPUT.
exposed=$(grep -rn --include='*.ts' --exclude='*.test.ts' "public_display_name" backend/src/controllers 2>/dev/null || true)
if [[ -n "$exposed" ]]; then
  offending=$(
    echo "$exposed" | while IFS=: read -r file line _; do
      # The nearest preceding top-level declaration owns this line.
      owner=$(awk -v n="$line" '
        NR > n { exit }
        /^(export )?(interface|function|const) [A-Za-z_]+/ {
          for (i = 1; i <= NF; i++) {
            if ($i == "interface" || $i == "function" || $i == "const") {
              owner = $(i + 1); sub(/[^A-Za-z_].*$/, "", owner); break
            }
          }
        }
        END { print owner }
      ' "$file")
      case "$owner" in
        UserDto | userDto | createSchema) ;;
        *) echo "$file:$line: inside \`$owner\`" ;;
      esac
    done
  )
  if [[ -n "$offending" ]]; then
    echo "FAIL: the raw field is exposed outside the staff user surface (§20 rule 21):"
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

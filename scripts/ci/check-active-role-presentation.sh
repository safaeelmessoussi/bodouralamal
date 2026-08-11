#!/usr/bin/env bash
# SRS Revision 60 — presentation reads the ACTIVE role, never the account's roles.
#
# ## The rule
#
#   roles        → the role switcher's menu, and nothing else.
#   activeRole   → labels ("you are working as …").
#   activeRoles  → EVERY other presentation decision: navigation, dashboards,
#                  route guards, menus, visibility, write affordances.
#
# ## Why a guard exists at all
#
# R60 narrowed the SERVER and left the client reading `me.roles` — the full list
# `/me` deliberately keeps so the switcher can offer a way back. Thirteen
# presentation sites were answering *what could this account do* where the
# question was *what is it doing now*, and it shipped two visible defects: the
# dashboard button sent a Super Admin working as مؤطِّرة to `/admin`, and the
# back-office sidebar listed Super Admin modules to somebody acting as Admin.
#
# Both were invisible to every test, because both lists are real and either one
# type-checks. Only a rule about WHICH list may be read can catch the next one.
#
# ## Why a source scan rather than an ESLint rule
#
# The project has no ESLint plugin configuration and twelve guards of exactly
# this shape already wired into CI. A custom rule would mean a new dependency
# and a plugin package to pin (§3.1a), to catch a pattern that is a grep. The
# smallest reliable mechanism is the one the repository already runs.
#
# ## What it cannot catch, stated rather than implied
#
# A value laundered through an intermediate — `const s = me; s.roles` — is
# beyond a regex, and pretending otherwise would be worse than the gap. What it
# does catch is every *direct* read and every destructuring of the session's
# role list, which is how all thirteen sites were written and how a fourteenth
# would be.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

status=0

# Files permitted to read the FULL role list, each for a stated reason.
#
#   contexts/active-role.tsx     — owns the distinction; publishes both.
#   contexts/session.tsx         — types and fetches `/me`.
#   header/role-switcher.tsx     — the menu IS the full list.
#   hooks/use-navigation.ts      — `hasMultipleRoles` asks "is there a choice to
#                                  offer", which is a switcher question.
ALLOWED='contexts/active-role\.tsx|contexts/session\.tsx|header/role-switcher\.tsx|hooks/use-navigation\.ts'

# Comments quote the forbidden pattern when explaining it — including in this
# guard's own commit. Strip them before matching, or the explanation trips it.
scan() {
  local pattern="$1" label="$2"
  local hits=''
  while IFS= read -r file; do
    [[ "$file" =~ $ALLOWED ]] && continue
    [[ "$file" == *.test.* ]] && continue
    local found
    # `-P` for the lookbehind in check 3: `{ activeRoles: roles }` RENAMES the
    # narrowed list and must not be mistaken for reading the full one.
    found=$(sed -e 's://.*::' -e 's:^\s*\*.*::' "$file" | grep -nP "$pattern" || true)
    [[ -n "$found" ]] && hits+="$(echo "$found" | sed "s|^|  ${file}:|")"$'\n'
  done < <(find frontend/src -type f \( -name '*.ts' -o -name '*.tsx' \))

  if [[ -n "$hits" ]]; then
    echo "FAIL: $label"
    printf '%s' "$hits"
    status=1
  fi
}

# 1. Any direct read of the session's role list. Covers `me.roles`,
#    `me?.roles` and `useSession().me.roles`.
scan '\bme\s*\??\s*\.\s*roles\b' \
  "presentation read \`me.roles\` — the account's full list. Use \`activeRoles\` from useActiveRole() (R60)."

# 2. The same list reached by destructuring, which is the obvious way around (1).
scan '\{[^}]*\broles\b[^}]*\}\s*=\s*me\b' \
  "presentation destructured \`roles\` out of \`me\` — same list, same rule (R60)."

# 3. The full list taken from the context that publishes both. Legitimate only
#    for the switcher's menu, which is in the allowlist.
# The binding must be `roles` itself, not `activeRoles` and not the RENAME
# `{ activeRoles: roles }` — hence three fixed-length lookbehinds, and a
# lookahead so the closing brace stays available to the rest of the pattern.
scan '\{[^}]*(?<!\w)(?<!:)(?<!:\s)roles\s*(?=[,}])[^}]*\}\s*=\s*useActiveRole\(\)' \
  "presentation destructured \`roles\` from useActiveRole() — that is the switcher's menu. Use \`activeRoles\` (R60)."

if [[ $status -eq 0 ]]; then
  echo "OK: presentation reads the active role, not the account's roles (R60)."
fi
exit $status

#!/usr/bin/env bash
# **The public chrome offers sign-in in exactly one place, and that place asks
# the deployment first** (SRS R175 §2, Owner 2026-09-26).
#
# The temporary Production tier publishes a public calendar and a public
# library while registration is not yet announced. It hides «تسجيل الدخول» by
# answering `sign_in_offered: false` on `GET /site-config` — which works only
# while every public surface goes through the ONE shared control that reads
# that flag. A raw `<a href="/api/v1/auth/google">` added to a header, a menu
# or a hero would reopen the invitation silently, on a tier whose published
# privacy notice says registration is not open.
#
# Two pages are deliberate exceptions, both the Owner's explicit choice: the
# `/login` page (nothing links to it; it is where an OAuth failure lands with
# its retry, §14.4, and it is the Owner's own way in) and the `/register` page
# (§4.1b's own entry — the Owner keeps it open and takes responsibility for
# any request that arrives). Neither is reachable from the public chrome.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BUTTON="frontend/src/components/header/auth-buttons.tsx"
LOGIN_PAGE="frontend/src/pages/public.tsx"
REGISTER_PAGE="frontend/src/pages/register.tsx"
fail=0

# 1 · The shared control consults the flag.
grep -q "signInOffered" "$BUTTON" || {
  echo "FAIL: $BUTTON no longer reads signInOffered — the deployment can no longer hide sign-in"
  fail=1
}

# 2 · Nobody else links to the OAuth entry.
offenders="$(grep -rl "/api/v1/auth/google" frontend/src --include='*.tsx' --include='*.ts' \
  | grep -v "^${BUTTON}$" | grep -v "^${LOGIN_PAGE}$" | grep -v "^${REGISTER_PAGE}$" \
  | grep -v '\.test\.' || true)"
if [ -n "$offenders" ]; then
  echo "FAIL: a second, ungated link to the OAuth entry:"
  echo "$offenders" | sed 's/^/  /'
  echo "      Render <SignInButton /> instead — it asks the deployment first (R175 §2)."
  fail=1
fi

# 3 · The server still publishes the flag.
grep -q "SIGN_IN_OFFERED" backend/src/lib/config.ts \
  && grep -q "sign_in_offered" backend/src/controllers/site-config.controller.ts || {
  echo "FAIL: the server no longer publishes sign_in_offered (GET /site-config, R175 §2)"
  fail=1
}

[ "$fail" -eq 0 ] || exit 1
echo "OK: sign-in is offered through one control, and that control asks the deployment."

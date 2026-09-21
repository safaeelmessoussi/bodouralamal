#!/usr/bin/env bash
#
# The backend never reads the PROCESS's local clock.
#
# WHY THIS EXISTS
# ---------------
# Node converts local time with the zone data COMPILED INTO ITS BINARY, and a
# container image freezes that on the day it was built. On 2026-09-20 Morocco
# moved to UTC+0; the host knew the same day (Ubuntu ships tzdata automatically)
# and the platform stayed an hour ahead of the country (SRS Revision 167 §2).
#
# Morocco's time is answered by backend/src/lib/morocco-clock.ts, from the HOST's
# zone file. A local getter, a local `new Date(y, m, d, …)` or a `toLocale…`
# without an explicit zone anywhere else in src/ silently goes back to the
# frozen copy — and is right today, which is what makes it dangerous.
#
# Comment lines are skipped (this rule is quoted in several). `getUTC*`/`setUTC*`/
# `Date.UTC` are fine: dates and class times are `date` and
# `time` columns read through the UTC getters by design (TD-11).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

pattern='\.(get|set)(Hours|Minutes|Seconds|Date|Month|FullYear|Day)\(|getTimezoneOffset\(|\.toLocale(Date|Time)?String\(|new Date\([A-Za-z_.]+ *, *[A-Za-z_.0-9+ -]+ *,'

hits="$(grep -rnE "$pattern" backend/src --include='*.ts' \
  | grep -vE '\.test\.ts:|/generated/|/lib/morocco-clock\.ts:' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/?\*)' || true)"

if [[ -n "$hits" ]]; then
  echo "FAIL: backend/src reads the process's local clock (SRS Revision 167 §2)." >&2
  echo "      Use lib/morocco-clock.ts (moroccoParts, moroccoDateIso, moroccoTimeHHMM," >&2
  echo "      moroccoWallClockToInstant) so the answer follows the host's zone rules:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "OK: no local-clock reads in backend/src outside lib/morocco-clock.ts."

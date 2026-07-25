#!/usr/bin/env bash
# SRS §3.1 / §19.2: the SRS TD-3 route registry is the canonical API contract.
#
# The two directions carry different severities DURING the build, because they
# mean different things:
#
#   * OpenAPI has an endpoint TD-3 does NOT  → HARD FAIL, always. This is an
#     invented endpoint (§20 rule 16) and is never acceptable at any stage.
#   * TD-3 has an endpoint OpenAPI does not  → PENDING while the surface is
#     still being built. TD-3 describes the whole MVP, so this is simply true
#     of every milestone before the last, and failing on it would leave CI red
#     from M1 to M6 — a gate nobody can act on is a gate nobody reads.
#
# Setting TD3_REQUIRE_COMPLETE=1 makes the second direction fatal too; the §18
# Platform & Deployment checklist turns it on for the M8 release gate, which is
# where §3.1's "must conform" is asserted in full. The registry seed lives
# in scripts/ci/td3-routes.txt (derived from the SRS; never hand-edit
# docs/openapi.json to "fix" a mismatch — that is an implementation bug or an
# SRS revision, nothing else).
# Pre-M1 (no OpenAPI document generated yet) the check passes with a notice.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

OPENAPI="docs/openapi.json"
REGISTRY="scripts/ci/td3-routes.txt"

if [[ ! -f "$OPENAPI" ]]; then
  echo "NOTICE: $OPENAPI not generated yet (pre-M1 state) — TD-3 conformance check pending."
  exit 0
fi

python3 - "$OPENAPI" "$REGISTRY" <<'PY'
import json
import os
import re
import sys

openapi_path, registry_path = sys.argv[1], sys.argv[2]

def normalize(path: str) -> str:
    # Path parameters compare positionally: {upload_id} matches {id}.
    return re.sub(r"\{[^}]+\}", "{*}", path.rstrip("/") or "/")

# Every entry must cite the SRS clause that documents it — §3.1 (Revision 21)
# fails an endpoint implemented without SRS documentation, and an uncited entry
# is exactly that.
registry = set()
uncited = []
with open(registry_path, encoding="utf-8") as fh:
    for raw in fh:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        route, _, citation = line.partition("#")
        method, path = route.split(None, 1)
        if not citation.strip():
            uncited.append(route.strip())
        registry.add((method.upper(), normalize(path.strip())))

with open(openapi_path, encoding="utf-8") as fh:
    doc = json.load(fh)

HTTP_METHODS = {"get", "put", "post", "delete", "patch", "head", "options", "trace"}
implemented = set()
for raw_path, item in doc.get("paths", {}).items():
    # The OpenAPI doc may include or omit the /api/v1 prefix; registry paths
    # are prefix-relative (except /healthz).
    path = re.sub(r"^/api/v1", "", raw_path) or "/"
    for method in item:
        if method.lower() in HTTP_METHODS:
            implemented.add((method.upper(), normalize(path)))

extra = sorted(implemented - registry)
missing = sorted(registry - implemented)
require_complete = os.environ.get("TD3_REQUIRE_COMPLETE") == "1"

ok = True
if uncited:
    ok = False
    print("FAIL: registry entr(ies) with no SRS clause citation (§3.1, Revision 21).")
    print("      An endpoint with no documenting clause is an undocumented endpoint:")
    for route in uncited:
        print(f"  {route}")

if extra:
    ok = False
    print("FAIL: endpoint(s) in the OpenAPI document but NOT documented in the SRS (§3.1).")
    print("      Undocumented endpoints are forbidden (§20 rule 16):")
    for method, path in extra:
        print(f"  {method} {path}")

if missing:
    label = "FAIL" if require_complete else "PENDING"
    if require_complete:
        ok = False
    print(f"{label}: {len(missing)} TD-3 endpoint(s) not yet in the OpenAPI document.")
    if require_complete:
        for method, path in missing:
            print(f"  {method} {path}")

print(
    f"{len(implemented)}/{len(registry)} TD-3 endpoints implemented; "
    f"{len(extra)} undocumented (must be 0)."
)
if ok and not missing:
    print("OK: OpenAPI document conforms to the TD-3 registry exactly.")
elif ok:
    print("OK: no invented endpoints. Remaining TD-3 endpoints arrive with their milestones.")
sys.exit(0 if ok else 1)
PY

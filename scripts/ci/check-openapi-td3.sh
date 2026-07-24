#!/usr/bin/env bash
# SRS §3.1 / §19.2: the SRS TD-3 route registry is the canonical API contract.
# CI fails if the generated OpenAPI document (docs/openapi.json) contains an
# endpoint absent from TD-3 or omits a TD-3 endpoint. The registry seed lives
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
import re
import sys

openapi_path, registry_path = sys.argv[1], sys.argv[2]

def normalize(path: str) -> str:
    # Path parameters compare positionally: {upload_id} matches {id}.
    return re.sub(r"\{[^}]+\}", "{*}", path.rstrip("/") or "/")

registry = set()
with open(registry_path, encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        method, path = line.split(None, 1)
        registry.add((method.upper(), normalize(path)))

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

ok = True
if extra:
    ok = False
    print("FAIL: endpoint(s) in the OpenAPI document but absent from the TD-3 registry (§3.1):")
    for method, path in extra:
        print(f"  {method} {path}")
if missing:
    ok = False
    print("FAIL: TD-3 registry endpoint(s) missing from the OpenAPI document (§3.1):")
    for method, path in missing:
        print(f"  {method} {path}")

if ok:
    print(f"OK: OpenAPI document conforms to the TD-3 registry ({len(registry)} endpoints).")
sys.exit(0 if ok else 1)
PY

#!/usr/bin/env bash
# TD-14: public input and personal identity must not cross the operational-log
# or indefinitely retained AuditLog boundaries.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail=0
forbidden() {
  local needle="$1"
  local file="$2"
  local reason="$3"
  if grep -nF -- "$needle" "$file"; then
    echo "ERROR: $reason ($file)" >&2
    fail=1
  fi
}

forbidden '$http_x_request_id' nginx/nginx.conf \
  'a public client request id would be copied into logs/envelopes'
forbidden '"uri":"$uri"' nginx/nginx.conf \
  'raw caller-controlled paths must not enter Nginx access logs'
forbidden '"uri":"$request_uri"' nginx/nginx.conf \
  'raw caller-controlled paths/queries must not enter Nginx access logs'
forbidden '"remote_addr":"$remote_addr"' nginx/nginx.conf \
  'client network addresses must not enter the no-PII access log'
forbidden 'path: req.path' backend/src/middleware/request-context.ts \
  'Express must log a registered route template, not the requested coordinate'
forbidden 'error.message' backend/src/middleware/request-context.ts \
  'HTTP exception text may contain PII, SQL, storage keys or secrets'
forbidden 'error.message' backend/src/index.ts \
  'job-start exception text may contain connection strings or secrets'
forbidden 'pre_provisioned_email: email' backend/src/services/user.service.ts \
  'an indefinitely retained user.create audit must not copy the mailbox'

require() {
  local needle="$1"
  local file="$2"
  local reason="$3"
  if ! grep -qF -- "$needle" "$file"; then
    echo "ERROR: missing no-PII logging invariant: $reason ($file)" >&2
    fail=1
  fi
}

require 'proxy_set_header X-Request-Id      $request_id;' nginx/snippets/api-proxy.conf \
  'Nginx-generated correlation id is forwarded to the API'
require 'error_log  /var/log/nginx/error.log emerg;' nginx/nginx.conf \
  'Nginx request diagnostics cannot echo raw client coordinates at request-time levels'
require "'<unmatched>'" backend/src/middleware/request-context.ts \
  'unmatched requests use a constant access-log coordinate'
require "message: 'unhandled application error'" backend/src/middleware/request-context.ts \
  'internal errors use a fixed safe operator message'
require "identity_channel: 'pre_provisioned'" backend/src/services/user.service.ts \
  'user creation records a non-identifying identity channel'

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo 'no-PII logging guard: untrusted ids/paths, exception text and identity mailboxes stay out'

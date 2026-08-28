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
forbidden 'detail: { storage_key: existing.storageKey }' backend/src/services/content.service.ts \
  'content deletion must not copy a filename-derived object key into indefinite audit'
forbidden 'previous_key: existing.storageKey' backend/src/services/content.service.ts \
  'content replacement must not copy the retired filename-derived key into indefinite audit'
forbidden 'label: labelOf(entry.snapshot)' backend/src/services/trash.service.ts \
  'permanent deletion must not copy a display label into indefinite audit'

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
require 'assertMinimizedDetail(entry.detail);' backend/src/repositories/audit.repository.ts \
  'all durable audit writes pass through the copied-value boundary'
require 'storage_coordinate_id: storageCoordinateId(' backend/src/services/content.service.ts \
  'content lifecycle audit uses a non-reversible exact-coordinate identity'
require 'contentSha256 === null' backend/src/services/content.service.ts \
  'current finalization retries derive their key while legacy audit rows retain compatibility'

# The property-name guard protects the architecture only if Production code
# cannot write AuditLog through Prisma directly. Parse TypeScript rather than
# grep prose: a comment explaining the forbidden form must not fail the guard.
if ! (
  cd backend
  node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const findings = [];
const writeMethods = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);

function inspect(file) {
  const source = fs.readFileSync(file, 'utf8');
  const unit = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      writeMethods.has(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'auditLog'
    ) {
      const line = unit.getLineAndCharacterOfPosition(node.getStart(unit)).line + 1;
      findings.push(`${file}:${line}:${node.getText(unit)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(unit);
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'generated') walk(file);
    } else if (
      file.endsWith('.ts') &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.integration.test.ts') &&
      file !== path.join('src', 'repositories', 'audit.repository.ts')
    ) {
      inspect(file);
    }
  }
}

walk('src');
if (findings.length > 0) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.stderr.write('ERROR: Production AuditLog writes must use audit.repository.ts\n');
  process.exit(1);
}
NODE
); then
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo 'no-PII logging guard: operational inputs and copied durable-audit detail stay minimized'

import { writeFileSync } from 'node:fs';

import { createApp } from '../src/app.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import type { AppConfig } from '../src/lib/config.js';

/**
 * Placeholder values used only to build the router for introspection. Generation
 * must not require a configured environment — CI's contract job deliberately runs
 * with no secrets — and nothing here is ever used to serve a request or to reach
 * the network.
 */
const SYNTHETIC_CONFIG: AppConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  GOOGLE_CLIENT_ID: 'unused',
  GOOGLE_CLIENT_SECRET: 'unused',
  JWT_SIGNING_KEY: 'unused',
  ONBOARDING_TOKEN_KEY: 'unused',
  MINIO_ENDPOINT: 'http://127.0.0.1:1',
  MINIO_ACCESS_KEY: 'unused',
  MINIO_SECRET_KEY: 'unused',
  PUBLIC_BASE_URL: 'http://127.0.0.1',
  STORAGE_BASE_URL: 'http://127.0.0.1/storage',
  SUPER_ADMIN_EMAIL: 'unused@example.com',
  NODE_ENV: 'test',
  TZ: 'Africa/Casablanca',
  PORT: 3000,
  LOG_LEVEL: 'info',
};

/**
 * Generates `docs/openapi.json` from the routes this implementation actually
 * serves (SRS §3.1, §19.2).
 *
 * Precedence is one-directional and absolute: the **SRS TD-3 registry is the
 * canonical contract**, and this document is a generated artifact of the
 * implementation that must conform to it. CI compares the two in both
 * directions. **Never hand-edit this file to make the check pass** — a mismatch
 * is an implementation bug or an SRS revision, never a documentation fix.
 *
 * Only routes already implemented appear here; the remaining TD-3 endpoints
 * join as their milestones land.
 */

interface Operation {
  summary: string;
  description: string;
  responses: Record<string, { description: string }>;
}

const ENVELOPE = 'Error envelope (TD-3.8).';

function op(summary: string, description: string, responses: Record<string, string>): Operation {
  return {
    summary,
    description,
    responses: Object.fromEntries(
      Object.entries(responses).map(([status, text]) => [status, { description: text }]),
    ),
  };
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'بذور الأمل Platform API',
    version: '0.1.0',
    description:
      'Generated from the implementation. The SRS TD-3 route registry is the canonical ' +
      'contract (§3.1); this document must conform to it and is never hand-edited.',
  },
  servers: [{ url: '/api/v1', description: 'Same-origin API path (§3.1)' }],
  paths: {
    '/auth/google': {
      get: op(
        'Begin Google OAuth',
        'Redirects to Google with state + PKCE (§4.1b steps 1–2, TD-12).',
        { '302': 'Redirect to Google.' },
      ),
    },
    '/auth/google/callback': {
      get: op(
        'Google OAuth callback',
        '§4.1b routing: existing identity → session by status; pre-provisioned email match → ' +
          'bind identity → session by status; unknown → onboarding. Failures are REDIRECTS to ' +
          '/login?error=<key>, never the TD-3.8 envelope (§4.1b step 7).',
        { '302': 'Redirect by routing decision, or to /login?error=<key> on failure.' },
      ),
    },
    '/auth/refresh': {
      post: op(
        'Rotate the refresh token',
        'The ONLY cookie-authenticated route (TD-12). Requires X-Requested-With and an Origin ' +
          'matching PUBLIC_BASE_URL. Rotation, the 10s predecessor grace window, and ' +
          'reuse detection are per TD-4.13 and §18 T1–T12.',
        {
          '200': 'New access token; a rotated refresh cookie unless the grace window applied.',
          '401': `${ENVELOPE} All refusal reasons are deliberately indistinguishable.`,
        },
      ),
    },
    '/auth/logout': {
      post: op(
        'Log out of the current session',
        'Revokes the current session only; other devices are unaffected (TD-4.14).',
        { '204': 'Session revoked. Idempotent.' },
      ),
    },
    '/me': {
      get: op(
        'Current identity',
        'Identity, roles, branch scopes, account_status and approved child links. The only ' +
          'endpoint (with logout) that a Pending session may call (TD-1).',
        { '200': 'Current user.', '401': ENVELOPE },
      ),
    },
    '/registrations': {
      post: op('Unified registration', 'Public, gated by the signed onboarding token in X-Onboarding-Token (§4.1b step 4c). Adult self-registration or parent+child in ONE transaction (TD-4.1). Identity comes solely from the token payload — the schema rejects email/provider_subject_id outright (§20 rule 9). New accounts enter Pending.', { '201': 'Created; account_status pending.', '400': `${ENVELOPE} VALIDATION_FAILED or CONSENT_REQUIRED.`, '409': `${ENVELOPE} STATE_CONFLICT on token replay; DUPLICATE if the identity exists.`, '503': `${ENVELOPE} consent text version not configured (§2.3).` }),
    },
    '/admin/approvals': {
      get: op('Approval queue', 'Admin or Super Admin only (TD-2), re-asserted against live rows per request because approvals are a TD-12 high-risk surface. Two item types share the queue: `registration` (a pending applicant together with any pending child and link that arrived as one §4.1 bundle) and `family-link` (a standalone §4.3 "Link a Child" request). A pending child is never listed separately — it appears inside its parent\'s bundle so the family is approved once. Paginated per TD-10 (default 25, max 100), oldest first.', { '200': 'Queue page; each item carries its applicants and what approving it will change.', '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN when the caller is no longer Active or the admin role assignment no longer exists (TD-12).` }),
    },
    '/admin/approvals/{id}/approve': {
      post: op('Approve a queue item', 'TD-4.2: parent activation, child activation, link approval and the audit row commit in ONE transaction — §4.3 requires all three atomically, since a half-approved bundle is a parent who can see a child whose own record is still Pending. TD-1 transition Pending → Active. Approval does NOT assign roles. Concurrent decisions are first-wins (TD-15.3): the loser gets 409, never a 500.', { '200': 'Approved; reports the item type and how many accounts were activated.', '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).`, '404': `${ENVELOPE} NOT_FOUND for an unknown id.`, '409': `${ENVELOPE} STATE_CONFLICT when the item was already decided.` }),
    },
    '/admin/approvals/{id}/reject': {
      post: op('Reject a queue item', 'Requires a reason (§5.6, §14.2) of at most 500 characters (TD-9) — rejecting a family\'s application without recording why is not an auditable decision. Rejection is atomic across the bundle in the same way as approval (TD-4.2): the parent and child are never left half-decided. TD-1 transition Pending → Rejected.', { '200': 'Rejected; the reason is stored on the decision and in the audit row.', '400': `${ENVELOPE} VALIDATION_FAILED when the reason is missing or too long.`, '401': ENVELOPE, '403': ENVELOPE, '404': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT when the item was already decided.` }),
    },
    '/admin/family-links/{id}': {
      delete: op('Revoke an approved family link', 'Admin or Super Admin (TD-2), asserted against live rows per request. §4.3 Revision 16: soft-deleting the row IS the revocation mechanism — TD-1 keeps `Approved` terminal and no `Approved → Revoked` transition exists, because enforcement is already complete: the `X-Active-Child-ID` middleware re-checks the link on every request, so revocation takes effect on the very NEXT request. Follows the ordinary TD-4.8 soft-delete transaction (`deleted_at`/`deleted_by` + Trash snapshot + `familylink.revoke` audit carrying both parties and the reason). A reason of 1–500 characters is required (TD-9). The TD-6 partial unique index covers non-deleted rows only, so the same pair can be requested again later as a fresh Pending link.', { '200': 'Revoked; the parent loses access to that child immediately.', '400': `${ENVELOPE} VALIDATION_FAILED when the reason is missing or too long.`, '401': ENVELOPE, '403': `${ENVELOPE} FORBIDDEN (TD-12 freshness or TD-2 role).`, '404': `${ENVELOPE} NOT_FOUND for an unknown or already-revoked link.`, '409': `${ENVELOPE} STATE_CONFLICT when the link is not Approved — pending and rejected links are decided through the approval queue.` }),
    },
    '/admin/branches': {
      get: op('List branches', 'Ordered by display_order ASC NULLS LAST then name (ar-x-icu collated, §2.2/TD-10). Admins see their scoped branches; Super Admins see all.', { '200': 'Branch list.', '401': ENVELOPE, '403': ENVELOPE }),
      post: op('Create a branch', 'Admin or Super Admin (TD-2). display_order is Super Admin only (§2.2).', { '201': 'Created.', '400': ENVELOPE, '403': ENVELOPE }),
    },
    '/admin/branches/{id}': {
      patch: op('Update a branch', 'Optimistic locking on `version` (TD-15): a stale version returns 409 VERSION_CONFLICT rather than overwriting silently.', { '200': 'Updated.', '404': ENVELOPE, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
      delete: op('Soft-delete a branch', 'Prohibited while Rooms or Groups reference it (TD-5) — 409 STATE_CONFLICT. Writes a Trash snapshot and an audit row (TD-4.8).', { '204': 'Deleted.', '404': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT when referenced.` }),
    },
    '/admin/branches/{id}/rooms': {
      get: op('List a branch\'s rooms', 'Scoped to the branch (§5.6).', { '200': 'Room list.', '404': ENVELOPE }),
      post: op('Create a room', 'Within the given branch (§5.6).', { '201': 'Created.', '400': ENVELOPE, '404': ENVELOPE }),
    },
    '/admin/rooms/{id}': {
      patch: op('Update a room', 'Optimistic locking on `version` (TD-15).', { '200': 'Updated.', '404': ENVELOPE, '409': `${ENVELOPE} VERSION_CONFLICT.` }),
      delete: op('Soft-delete a room', 'Prohibited while Groups reference it (TD-5).', { '204': 'Deleted.', '404': ENVELOPE, '409': `${ENVELOPE} STATE_CONFLICT when referenced.` }),
    },
    '/healthz': {
      // TD-14 serves this at the ORIGIN root, outside the /api/v1 prefix, so the
      // document must override the global server base. Without this the contract
      // advertises /api/v1/healthz, which falls inside the guarded router and
      // answers 401 — a consumer following the document would call the wrong URL
      // and conclude the service was unhealthy.
      servers: [{ url: '/', description: 'Served at the origin root (TD-14)' }],
      get: op(
        'Health check',
        'Public. Checks database, storage and job-queue components (TD-14); §19.1 step 8 ' +
          'asserts a 200 here on deployment.',
        { '200': 'All components healthy.', '503': 'At least one component is down.' },
      ),
    },
  },
};

// ── Reconcile against the routes the application ACTUALLY serves ────────────
//
// The path map above is hand-written, so on its own it proves nothing: a route
// documented here and in the TD-3 registry, but never mounted on the router,
// passed every gate while returning 404 to real callers. That happened, and only
// an HTTP-level test caught it — the drift check compares this file's output to
// the committed copy, and the §3.1 conformance check compares that output to the
// registry, so neither ever consults the router.
//
// Walking the real Express stack here is what makes "generated from the
// implementation" true rather than aspirational. `createApp` takes its config and
// client as parameters, so this needs no environment and no database connection —
// constructing a PrismaClient does not connect.
function mountedOperations(): Set<string> {
  const app = createApp(createPrismaClient(SYNTHETIC_CONFIG.DATABASE_URL), SYNTHETIC_CONFIG);

  const found = new Set<string>();
  const walk = (stack: unknown[], prefix: string): void => {
    for (const entry of stack) {
      const layer = entry as {
        route?: { path?: string; methods?: Record<string, boolean> };
        name?: string;
        handle?: { stack?: unknown[] };
        path?: string;
      };

      if (layer.route?.path) {
        // Express 5 normalizes `:id` params; the contract uses `{id}`.
        const path = `${prefix}${layer.route.path}`.replace(/:([A-Za-z_]\w*)/g, '{$1}');
        for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
          if (enabled && method !== '_all') found.add(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.handle?.stack) {
        // A nested router. Express 5 does not expose the mount path reliably on
        // the layer, so recurse with the same prefix: every nested router in this
        // application is mounted at the API prefix, which the comparison strips
        // anyway.
        walk(layer.handle.stack, prefix);
      }
    }
  };

  const root = (app as unknown as { router?: { stack?: unknown[] } }).router;
  walk(root?.stack ?? [], '');
  return found;
}

const documented = new Set<string>();
for (const [path, item] of Object.entries(document.paths)) {
  for (const method of Object.keys(item)) {
    if (method === 'servers') continue;
    documented.add(`${method.toUpperCase()} ${path}`);
  }
}

const mounted = mountedOperations();
const undocumented = [...mounted].filter((op) => !documented.has(op)).sort();
const unserved = [...documented].filter((op) => !mounted.has(op)).sort();

if (undocumented.length > 0 || unserved.length > 0) {
  if (unserved.length > 0) {
    process.stderr.write(
      `DOCUMENTED BUT NOT SERVED (the contract would advertise a 404):\n  ${unserved.join('\n  ')}\n`,
    );
  }
  if (undocumented.length > 0) {
    process.stderr.write(
      `SERVED BUT NOT DOCUMENTED (§3.1 forbids undocumented endpoints):\n  ${undocumented.join('\n  ')}\n`,
    );
  }
  process.stderr.write(
    'The OpenAPI path map and the Express router disagree. Fix whichever is wrong —\n' +
      'do not "resolve" this by editing docs/openapi.json (§3.1).\n',
  );
  process.exit(1);
}

const target = new URL('../../docs/openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
process.stdout.write(
  `openapi.json written: ${Object.keys(document.paths).length} paths, ` +
    `${documented.size} operations, all reconciled against the live router\n`,
);

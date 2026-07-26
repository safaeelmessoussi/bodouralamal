import { writeFileSync } from 'node:fs';

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

const target = new URL('../../docs/openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
process.stdout.write(`openapi.json written: ${Object.keys(document.paths).length} paths\n`);

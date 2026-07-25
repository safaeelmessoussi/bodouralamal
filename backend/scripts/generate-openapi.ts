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
    '/healthz': {
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

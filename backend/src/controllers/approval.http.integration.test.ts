import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { httpCall } from '../test-support/http-client.js';
import { CONSENT_TEXT_VERSION_KEY, register } from '../services/registration.service.js';

/**
 * Approval routes over real HTTP, through Nginx (TD-3.2, §5.6).
 *
 * The service-level suite proves the decisions; this proves the *wiring* —
 * route paths, the authenticate middleware, status codes and the TD-3.8 error
 * envelope. Those are invisible to a service test: a route mounted at the wrong
 * path, or outside the guarded router, would leave every service test green.
 *
 * Requires the compose stack, with the api image built from current source:
 *   docker compose up -d --build api
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-appr-test]';

interface Res {
  status: number;
  body: { error?: { code?: string }; data?: unknown[]; meta?: { page_size?: number }; type?: string };
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  return httpCall<Res['body']>(BASE, method, path, { token, ...(body !== undefined ? { body } : {}) });
}

function bearer(userId: string, roles: string[], accountStatus = 'active'): string {
  return issueAccessToken(
    { userId, roleScopes: roles.map((role) => ({ role, branches: null })), accountStatus: accountStatus as never },
    config.JWT_SIGNING_KEY,
  ).token;
}

async function makeStaff(role: string): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${role}`, accountStatus: 'active' },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

let counter = 0;
async function submitBundle(): Promise<{ parentId: string; childId: string }> {
  counter += 1;
  const stamp = `${Date.now()}-${counter}`;
  const { token } = issueOnboardingToken(
    { email: `httpappr-${stamp}@example.com`, providerSubjectId: `httpapprsub-${stamp}` },
    config.ONBOARDING_TOKEN_KEY,
  );
  const result = await register(
    prisma,
    token,
    {
      kind: 'parent_child',
      parent: { name_arabic: `${TAG} والدة`, sex: 'female' as const },
      child: { name_arabic: `${TAG} طفلة`, sex: 'female' as const },
      consents: { data_processing: true, media_release: true },
    },
    config.ONBOARDING_TOKEN_KEY,
  );
  return { parentId: result.applicantId, childId: result.childId! };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.consumedToken.deleteMany({ where: { purpose: 'onboarding' } });
}

let adminId: string;
let teacherId: string;
let admin: string;
let teacher: string;

beforeAll(async () => {
  // Fail loudly rather than skipping (§19.2): a silently skipped wiring test is
  // indistinguishable from a passing one.
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${config.PUBLIC_BASE_URL}/healthz — run: docker compose up -d --build api`,
    );
  }

  await clear();
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: 'http-appr-v1' },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: 'http-appr-v1' },
  });
  adminId = await makeStaff('admin');
  teacherId = await makeStaff('teacher');
  admin = bearer(adminId, ['admin']);
  teacher = bearer(teacherId, ['teacher']);
});

afterAll(async () => {
  await clear();
  await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
  await prisma.$disconnect();
});

describe('GET /api/v1/admin/approvals', () => {
  it('is mounted, guarded, and answers the TD-10 envelope to an admin', async () => {
    const { parentId } = await submitBundle();
    const res = await call('GET', '/admin/approvals', admin);

    expect(res.status).toBe(200);
    expect(res.body.meta?.page_size).toBe(25);
    // Proves the route is really mounted at this path: a 401-from-nowhere would
    // look identical to an unmatched path under the guarded router.
    expect((res.body.data as { id: string }[]).some((i) => i.id === parentId)).toBe(true);
  });

  it('§16.2: an item is the contract DTO — snake_case, and exactly these keys', async () => {
    // Asserting the EXACT key set, not just the presence of the ones we want,
    // is the point: the failure this guards against is a field arriving that
    // nobody chose. A `toContain`-style check passes happily through that.
    const { parentId } = await submitBundle();
    const res = await call('GET', '/admin/approvals', admin);
    const item = (res.body.data as Record<string, unknown>[]).find((i) => i.id === parentId)!;

    expect(Object.keys(item).sort()).toEqual(
      ['applicants', 'bundle', 'id', 'submitted_at', 'type'],
    );
    expect(Object.keys(item.bundle as object).sort()).toEqual(['child_count', 'link_count']);
    const applicant = (item.applicants as Record<string, unknown>[])[0]!;
    expect(Object.keys(applicant).sort()).toEqual(['id', 'name', 'role']);
    // `submitted_at` is an instant, correctly — a submission is a moment.
    expect(item.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('refuses an anonymous caller with the TD-3.8 envelope', async () => {
    const res = await call('GET', '/admin/approvals');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_REQUIRED');
  });

  it('refuses a tampered token signature', async () => {
    const res = await call('GET', '/admin/approvals', `${admin}x`);
    expect(res.status).toBe(401);
  });

  it('TD-2: a teacher holding a valid token gets 403, not a filtered list', async () => {
    const res = await call('GET', '/admin/approvals', teacher);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('TD-12: a token claiming admin for a NON-admin user is refused', async () => {
    // The claim is genuinely signed — only the database says otherwise. This is
    // the whole point of the freshness assertion: claims are not authority.
    const res = await call('GET', '/admin/approvals', bearer(teacherId, ['admin', 'super_admin']));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/admin/approvals/{id}/approve|reject', () => {
  it('approves a bundle end to end and reports what changed', async () => {
    const { parentId, childId } = await submitBundle();
    const res = await call('POST', `/admin/approvals/${parentId}/approve`, admin, {});

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('registration');
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('active');
    expect((await prisma.user.findUnique({ where: { id: childId } }))?.accountStatus).toBe('active');

    const second = await call('POST', `/admin/approvals/${parentId}/approve`, admin, {});
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('STATE_CONFLICT');
  });

  it('rejects with a reason, and refuses to reject without one', async () => {
    const { parentId } = await submitBundle();

    const bare = await call('POST', `/admin/approvals/${parentId}/reject`, admin, {});
    expect(bare.status).toBe(400);
    expect(bare.body.error?.code).toBe('VALIDATION_FAILED');

    // TD-9: 500 characters is the limit, so 501 must be refused at the edge.
    const tooLong = await call('POST', `/admin/approvals/${parentId}/reject`, admin, {
      reason: 'ط'.repeat(501),
    });
    expect(tooLong.status).toBe(400);

    const ok = await call('POST', `/admin/approvals/${parentId}/reject`, admin, {
      reason: 'الملف غير مكتمل',
    });
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('rejected');
  });

  it('a malformed id is 400 and a well-formed unknown one is 404', async () => {
    const malformed = await call('POST', '/admin/approvals/not-a-uuid/approve', admin, {});
    expect(malformed.status).toBe(400);

    // Shaped like a UUID but with an invalid version/variant nibble. Postgres
    // would accept it as a `uuid`; the edge rejects it as syntactically
    // impossible before any lookup, since every id this system issues is v4.
    const notRfcValid = await call(
      'POST',
      '/admin/approvals/11111111-2222-3333-4444-555555555555/approve',
      admin,
      {},
    );
    expect(notRfcValid.status).toBe(400);

    const unknown = await call(
      'POST',
      '/admin/approvals/11111111-2222-4333-8444-555555555555/approve',
      admin,
      {},
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe('NOT_FOUND');
  });

  it('a request with no body at all does not 500', async () => {
    const { parentId } = await submitBundle();
    const res = await call('POST', `/admin/approvals/${parentId}/approve`, admin);
    expect(res.status).toBe(200);
  });

  it('TD-12: suspending the admin revokes approval power without touching the token', async () => {
    const { parentId } = await submitBundle();
    const solo = await makeStaff('admin');
    const soloToken = bearer(solo, ['admin']);

    expect((await call('GET', '/admin/approvals', soloToken)).status).toBe(200);
    await prisma.user.update({ where: { id: solo }, data: { accountStatus: 'suspended' } });

    expect((await call('GET', '/admin/approvals', soloToken)).status).toBe(403);
    const denied = await call('POST', `/admin/approvals/${parentId}/approve`, soloToken, {});
    expect(denied.status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('pending');
  });
});

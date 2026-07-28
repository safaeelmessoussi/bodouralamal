import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { decide, listApprovals } from './approval.service.js';
import { CONSENT_TEXT_VERSION_KEY, register } from './registration.service.js';

/**
 * Approval queue (SRS §5.6, TD-4.2, TD-12, TD-15.3) against the real database.
 * Bundle atomicity and first-wins concurrency are enforced by the transaction
 * and by status guards, so this has to run against PostgreSQL.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const KEY = config.ONBOARDING_TOKEN_KEY;
const TAG = '[appr-test]';

let counter = 0;
function identity() {
  counter += 1;
  return {
    email: `appr-${Date.now()}-${counter}@example.com`,
    providerSubjectId: `apprsub-${Date.now()}-${counter}`,
  };
}

/** An Admin whose role row actually exists — TD-12 checks live rows, not claims. */
async function makeAdmin(role = 'admin'): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} مشرف`, accountStatus: 'active' },
  });
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: user.id, roleId: roleRow!.id, branchId: null },
  });
  return user.id;
}

async function submitBundle(): Promise<{ parentId: string; childId: string }> {
  const { token } = issueOnboardingToken(identity(), KEY);
  const result = await register(
    prisma,
    token,
    {
      kind: 'parent_child',
      parent: { name_arabic: `${TAG} والدة`, sex: 'female' as const },
      child: { name_arabic: `${TAG} طفلة`, sex: 'female' as const },
      consents: { data_processing: true, media_release: true },
    },
    KEY,
  );
  return { parentId: result.applicantId, childId: result.childId! };
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] } });
  await prisma.consentRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.familyLink.deleteMany({ where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.consumedToken.deleteMany({ where: { purpose: 'onboarding' } });
}

beforeEach(async () => {
  await clear();
  await prisma.systemSetting.upsert({
    where: { key: CONSENT_TEXT_VERSION_KEY },
    update: { value: 'appr-test-v1' },
    create: { key: CONSENT_TEXT_VERSION_KEY, value: 'appr-test-v1' },
  });
});

afterAll(async () => {
  await clear();
  await prisma.systemSetting.deleteMany({ where: { key: CONSENT_TEXT_VERSION_KEY } });
  await prisma.$disconnect();
});

describe('§5.6 / TD-4.2 approval queue', () => {
  it('lists a parent+child registration as ONE bundled item, not two', async () => {
    const admin = await makeAdmin();
    const { parentId, childId } = await submitBundle();

    const page = await listApprovals(prisma, admin, { type: 'registration' });
    const item = page.data.find((i) => i.id === parentId);

    expect(item).toBeDefined();
    // The child must not appear as its own queue entry: an admin approves the
    // family once (§4.3 "approval activates all three atomically").
    expect(page.data.some((i) => i.id === childId)).toBe(false);
    expect(item!.bundle).toEqual({ childCount: 1, linkCount: 1 });
    expect(item!.applicants.map((a) => a.role).sort()).toEqual(['applicant', 'child']);
  });

  it('TD-4.2: approving activates parent + child + link atomically', async () => {
    const admin = await makeAdmin();
    const { parentId, childId } = await submitBundle();

    const result = await decide(prisma, admin, parentId, { approve: true });
    expect(result.type).toBe('registration');

    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('active');
    expect((await prisma.user.findUnique({ where: { id: childId } }))?.accountStatus).toBe('active');
    const link = await prisma.familyLink.findFirst({ where: { parentId, studentId: childId } });
    expect(link?.status).toBe('approved');
    expect(link?.decidedById).toBe(admin);

    const row = await prisma.auditLog.findFirst({
      where: { targetId: parentId, actionType: 'user.approve' },
    });
    expect(row).not.toBeNull();
    expect((row!.detail as Record<string, unknown>)['children_activated']).toBe(1);
  });

  it('rejecting a bundle rejects parent AND child together, never half', async () => {
    const admin = await makeAdmin();
    const { parentId, childId } = await submitBundle();

    await decide(prisma, admin, parentId, { approve: false, reason: 'بيانات غير مكتملة' });

    // A rejected parent with a still-pending child would be a half-decided
    // family — TD-4.2's atomicity applies to both directions.
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('rejected');
    expect((await prisma.user.findUnique({ where: { id: childId } }))?.accountStatus).toBe('rejected');
    const link = await prisma.familyLink.findFirst({ where: { parentId } });
    expect(link?.status).toBe('rejected');
    expect(link?.decisionReason).toBe('بيانات غير مكتملة');
  });

  it('rejection without a reason is refused (§5.6, §14.2)', async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();
    await expect(decide(prisma, admin, parentId, { approve: false })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // Nothing decided.
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('pending');
  });

  it('TD-15.3: double-approval — first wins, second gets STATE_CONFLICT', async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();

    await decide(prisma, admin, parentId, { approve: true });
    await expect(decide(prisma, admin, parentId, { approve: true })).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('TD-15.3: two admins approving concurrently activate exactly once', async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    const { parentId } = await submitBundle();

    const results = await Promise.allSettled([
      decide(prisma, a1, parentId, { approve: true }),
      decide(prisma, a2, parentId, { approve: true }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // A benign outcome, never a 500 (TD-15.3).
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('active');
    expect(
      await prisma.auditLog.count({ where: { targetId: parentId, actionType: 'user.approve' } }),
    ).toBe(1);
  });

  it('TD-12 freshness: an admin suspended mid-session loses approval power at once', async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();

    // The token is still perfectly valid; only the database row changed.
    await prisma.user.update({ where: { id: admin }, data: { accountStatus: 'suspended' } });

    await expect(decide(prisma, admin, parentId, { approve: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await prisma.user.findUnique({ where: { id: parentId } }))?.accountStatus).toBe('pending');
  });

  it('TD-12 freshness: a REVOKED role assignment loses approval power at once', async () => {
    const admin = await makeAdmin();
    const { parentId } = await submitBundle();

    // Still Active, but the admin role row is gone — TD-12 requires the invoked
    // assignment to still exist, not merely to have existed at token issue.
    await prisma.userBranchRole.deleteMany({ where: { userId: admin } });

    await expect(decide(prisma, admin, parentId, { approve: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('TD-2: a non-admin cannot approve, and cannot even list', async () => {
    const teacher = await makeAdmin('teacher');
    const { parentId } = await submitBundle();

    await expect(listApprovals(prisma, teacher, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(decide(prisma, teacher, parentId, { approve: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('an unknown id is NOT_FOUND, not a 500 or a silent success', async () => {
    const admin = await makeAdmin();
    await expect(
      decide(prisma, admin, '11111111-2222-4333-8444-555555555555', { approve: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('TD-10: pagination envelope with default 25 and max 100', async () => {
    const admin = await makeAdmin();
    await submitBundle();
    const page = await listApprovals(prisma, admin, { pageSize: 500 });
    expect(page.meta.page_size).toBe(100);
    expect(page.meta.page).toBe(1);
    expect(typeof page.meta.total).toBe('number');
  });
});

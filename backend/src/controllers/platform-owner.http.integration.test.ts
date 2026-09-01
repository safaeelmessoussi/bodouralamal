import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { issueAccessToken } from '../lib/access-token.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import { resolveLogin } from '../services/auth.service.js';
import { httpCall } from '../test-support/http-client.js';

const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = `[platform-owner-http:${randomUUID()}]`;

interface ResponseBody {
  is_platform_owner?: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; details?: Record<string, unknown> };
}

const call = (method: string, path: string, token: string, body?: unknown) =>
  httpCall<ResponseBody>(BASE, method, path, {
    token,
    ...(body !== undefined ? { body } : {}),
  });

const token = (userId: string, role: string, branches: string[] | null = null) =>
  issueAccessToken(
    {
      userId,
      roleScopes: [{ role, branches }] as never,
      accountStatus: 'active' as never,
      activeRole: role,
    },
    config.JWT_SIGNING_KEY,
  ).token;

let originalOwnerId: string;
let originalOwnerVersion: number;
let originalOwnerUserVersion: number;
let originalOwnerNotification: {
  id: string;
  readAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
} | null;
let ownerToken: string;
let branchId: string;
let eligibleA: string;
let eligibleB: string;
let nonOwnerSuperAdmin: string;
let adminId: string;
let ordinaryId: string;
let branchSuperAdmin: string;
let suspendedSuperAdmin: string;
let deletedSuperAdmin: string;

async function createUser(
  suffix: string,
  role?: 'super_admin' | 'admin' | 'student',
  options: { branchId?: string | null; status?: 'active' | 'suspended'; deleted?: boolean } = {},
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${suffix}`,
      sex: 'female',
      accountStatus: options.status ?? 'active',
      ...(options.deleted ? { deletedAt: new Date() } : {}),
    },
  });
  if (role) {
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userBranchRole.create({
      data: {
        userId: user.id,
        roleId: roleRow.id,
        branchId: options.branchId ?? null,
        userStatus: 'active',
      },
    });
  }
  return user.id;
}

async function transfer(targetUserId: string, bearer: string) {
  return call('POST', '/admin/platform-owner/transfer', bearer, {
    target_user_id: targetUserId,
    confirmation: 'TRANSFER_PLATFORM_OWNERSHIP',
  });
}

async function restoreOriginalOwner(): Promise<void> {
  const current = await prisma.platformOwner.findUniqueOrThrow({
    where: { singletonKey: 'platform' },
  });
  if (current.ownerUserId === originalOwnerId) return;
  await prisma.platformOwner.update({
    where: { singletonKey: 'platform' },
    data: { ownerUserId: originalOwnerId, version: { increment: 1 } },
  });
}

/** Restore fixture-owned logical versions as well as the relationship itself.
 * Transfer and the former-owner lifecycle proof legitimately increment them;
 * leaving those increments behind would make this suite mutate the seed it was
 * supposed to observe. Timestamps need no rewrite because the all-table guard
 * deliberately excludes them. */
async function restoreOriginalState(): Promise<void> {
  await restoreOriginalOwner();
  await prisma.platformOwner.update({
    where: { singletonKey: 'platform' },
    data: { version: originalOwnerVersion },
  });
  await prisma.user.update({
    where: { id: originalOwnerId },
    data: { accountStatus: 'active', version: originalOwnerUserVersion },
  });
}

/**
 * Several proofs transfer ownership back through the real endpoint, which
 * correctly notifies the pre-existing Owner. That row belongs to this test
 * only when the exact semantic coordinate did not exist before the suite; on a
 * populated developer database an existing read/deleted state must instead be
 * restored byte-for-byte where it is logically significant.
 */
async function restoreOriginalOwnerNotification(): Promise<void> {
  const exact = {
    userId: originalOwnerId,
    subjectUserId: originalOwnerId,
    type: 'platform_ownership_received' as const,
  };
  if (originalOwnerNotification === null) {
    await prisma.notification.deleteMany({ where: exact });
    return;
  }
  await prisma.notification.update({
    where: { id: originalOwnerNotification.id },
    data: {
      readAt: originalOwnerNotification.readAt,
      createdAt: originalOwnerNotification.createdAt,
      deletedAt: originalOwnerNotification.deletedAt,
    },
  });
}

async function clear(): Promise<void> {
  await restoreOriginalOwner();
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length > 0) {
    await prisma.notification.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { subjectUserId: { in: ids } }] },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: ids } }, { targetId: { in: ids } }] },
    });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await restoreOriginalOwnerNotification();
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  const health = await fetch(`${config.PUBLIC_BASE_URL}/healthz`).catch(() => null);
  if (!health || health.status !== 200) throw new Error('API not reachable');
  const originalOwnership = await prisma.platformOwner.findUniqueOrThrow({
    where: { singletonKey: 'platform' },
  });
  originalOwnerId = originalOwnership.ownerUserId;
  originalOwnerVersion = originalOwnership.version;
  originalOwnerUserVersion = (
    await prisma.user.findUniqueOrThrow({ where: { id: originalOwnerId }, select: { version: true } })
  ).version;
  originalOwnerNotification = await prisma.notification.findFirst({
    where: {
      userId: originalOwnerId,
      subjectUserId: originalOwnerId,
      type: 'platform_ownership_received',
    },
    select: { id: true, readAt: true, createdAt: true, deletedAt: true },
  });
  ownerToken = token(originalOwnerId, 'super_admin');
  await clear();

  branchId = (await prisma.branch.create({ data: { name: `${TAG} فرع` } })).id;
  eligibleA = await createUser('أ', 'super_admin');
  eligibleB = await createUser('ب', 'super_admin');
  nonOwnerSuperAdmin = await createUser('مشرفة عليا', 'super_admin');
  adminId = await createUser('مديرة', 'admin');
  ordinaryId = await createUser('مستفيدة', 'student');
  branchSuperAdmin = await createUser('نطاق فرع', 'super_admin', { branchId });
  suspendedSuperAdmin = await createUser('موقوفة', 'super_admin', { status: 'suspended' });
  deletedSuperAdmin = await createUser('محذوفة', 'super_admin', { deleted: true });
});

afterEach(async () => {
  await restoreOriginalState();
  await restoreOriginalOwnerNotification();
});

afterAll(async () => {
  await clear();
  await restoreOriginalState();
  await prisma.$disconnect();
});

describe('Platform Owner transfer and lifecycle invariants', () => {
  it('requires the current owner and the explicit high-impact confirmation', async () => {
    const badConfirmation = await call('POST', '/admin/platform-owner/transfer', ownerToken, {
      target_user_id: eligibleA,
      confirmation: 'yes',
    });
    expect(badConfirmation.status).toBe(400);

    expect((await transfer(eligibleA, token(ordinaryId, 'student'))).status).toBe(403);
    expect((await transfer(eligibleA, token(adminId, 'admin'))).status).toBe(403);
    expect(
      (await transfer(eligibleA, token(nonOwnerSuperAdmin, 'super_admin'))).status,
    ).toBe(403);
  });

  it.each([
    ['branch-scoped Super Admin', () => branchSuperAdmin],
    ['suspended Super Admin', () => suspendedSuperAdmin],
    ['deleted Super Admin', () => deletedSuperAdmin],
    ['ordinary Admin', () => adminId],
  ])('refuses an ineligible %s target', async (_label, target) => {
    const response = await transfer(target(), ownerToken);
    expect(response.status).toBe(409);
    expect(response.body.error?.details?.['reason']).toBe('PLATFORM_OWNER_TARGET_INELIGIBLE');
  });

  it('refuses transfer to self', async () => {
    const response = await transfer(originalOwnerId, ownerToken);
    expect(response.status).toBe(409);
    expect(response.body.error?.details?.['reason']).toBe('PLATFORM_OWNER_TRANSFER_TO_SELF');
  });

  it('transfers atomically, audits UUID coordinates, and leaves the former owner a Super Admin', async () => {
    expect((await call('GET', '/me', ownerToken)).body.is_platform_owner).toBe(true);
    const response = await transfer(eligibleA, ownerToken);
    expect(response.status).toBe(200);
    expect((await prisma.platformOwner.count())).toBe(1);
    expect(
      (await prisma.platformOwner.findUniqueOrThrow({ where: { singletonKey: 'platform' } }))
        .ownerUserId,
    ).toBe(eligibleA);

    const formerRole = await prisma.userBranchRole.findFirst({
      where: {
        userId: originalOwnerId,
        branchId: null,
        deletedAt: null,
        userStatus: 'active',
        role: { name: 'super_admin' },
      },
    });
    expect(formerRole).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { actionType: 'platform_owner.transfer', targetId: eligibleA },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.actorUserId).toBe(originalOwnerId);
    expect(audit?.detail).toMatchObject({
      previous_owner_user_id: originalOwnerId,
      new_owner_user_id: eligibleA,
    });

    expect((await call('GET', '/me', ownerToken)).body.is_platform_owner).toBe(false);
    expect(
      (await call('GET', '/me', token(eligibleA, 'super_admin'))).body.is_platform_owner,
    ).toBe(true);

    expect((await transfer(originalOwnerId, token(eligibleA, 'super_admin'))).status).toBe(200);
  });

  it('serializes concurrent transfers so exactly one target wins', async () => {
    const [a, b] = await Promise.all([
      transfer(eligibleA, ownerToken),
      transfer(eligibleB, ownerToken),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const row = await prisma.platformOwner.findUniqueOrThrow({
      where: { singletonKey: 'platform' },
    });
    expect([eligibleA, eligibleB]).toContain(row.ownerUserId);
    expect(await prisma.platformOwner.count()).toBe(1);
    expect(
      (await transfer(originalOwnerId, token(row.ownerUserId, 'super_admin'))).status,
    ).toBe(200);
  });

  it('blocks every ordinary owner lifecycle entrance and the database backstops bulk writes', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: originalOwnerId } });

    const suspend = await call(
      'POST',
      `/admin/users/${originalOwnerId}/suspend`,
      token(nonOwnerSuperAdmin, 'super_admin'),
      { version: owner.version, reason: 'must fail' },
    );
    expect(suspend.status).toBe(409);
    expect(suspend.body.error?.details?.['reason']).toBe('PLATFORM_OWNER_PROTECTED');

    const remove = await call(
      'DELETE',
      `/admin/users/${originalOwnerId}`,
      token(nonOwnerSuperAdmin, 'super_admin'),
    );
    expect(remove.status).toBe(409);
    expect(
      (
        await call(
          'DELETE',
          `/admin/users/${originalOwnerId}?permanent=true`,
          token(nonOwnerSuperAdmin, 'super_admin'),
        )
      ).status,
    ).toBe(409);
    const wrongScope = await call(
      'PUT',
      `/admin/users/${originalOwnerId}/roles`,
      token(nonOwnerSuperAdmin, 'super_admin'),
      { assignments: [{ role: 'super_admin', branch_id: branchId }] },
    );
    expect(wrongScope.status).toBe(409);
    expect(wrongScope.body.error?.details?.['reason']).toBe(
      'PLATFORM_OWNER_GLOBAL_SUPER_ADMIN_REQUIRED',
    );
    expect((await call('DELETE', '/profile', ownerToken)).status).toBe(409);
    expect(
      (
        await call(
          'PUT',
          `/admin/users/${originalOwnerId}/roles`,
          token(nonOwnerSuperAdmin, 'super_admin'),
          { assignments: [] },
        )
      ).status,
    ).toBe(409);

    await expect(
      prisma.user.update({
        where: { id: originalOwnerId },
        data: { accountStatus: 'suspended' },
      }),
    ).rejects.toThrow(/Platform Owner/);
    await expect(
      prisma.platformOwner.delete({ where: { singletonKey: 'platform' } }),
    ).rejects.toThrow(/Platform Owner/);
    await expect(prisma.user.delete({ where: { id: originalOwnerId } })).rejects.toThrow(
      /Platform Owner/,
    );
    const assignment = await prisma.userBranchRole.findFirstOrThrow({
      where: { userId: originalOwnerId, deletedAt: null, role: { name: 'super_admin' } },
    });
    await expect(
      prisma.userBranchRole.update({
        where: { id: assignment.id },
        data: { deletedAt: new Date() },
      }),
    ).rejects.toThrow(/Platform Owner/);

    const superAdminRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'super_admin' },
    });
    await expect(
      prisma.role.update({
        where: { id: superAdminRole.id },
        data: { name: `${TAG}-renamed-role` },
      }),
    ).rejects.toThrow(/Platform Owner/);
  });

  it('lets the current Owner add and remove ordinary roles while retaining global Super Admin', async () => {
    expect((await transfer(eligibleA, ownerToken)).status).toBe(200);
    const successorToken = token(eligibleA, 'super_admin');

    const added = await call('PUT', `/admin/users/${eligibleA}/roles`, successorToken, {
      assignments: [
        { role: 'super_admin', branch_id: null },
        { role: 'student', branch_id: branchId },
      ],
    });
    expect(added.status).toBe(200);
    expect(
      await prisma.userBranchRole.count({
        where: {
          userId: eligibleA,
          deletedAt: null,
          branchId,
          role: { name: 'student' },
        },
      }),
    ).toBe(1);

    const removed = await call('PUT', `/admin/users/${eligibleA}/roles`, successorToken, {
      assignments: [{ role: 'super_admin', branch_id: null }],
    });
    expect(removed.status).toBe(200);
    expect(
      await prisma.userBranchRole.count({
        where: { userId: eligibleA, deletedAt: null, role: { name: 'student' } },
      }),
    ).toBe(0);
  });

  it('applies normal lifecycle rules to the former owner after transfer', async () => {
    expect((await transfer(eligibleA, ownerToken)).status).toBe(200);
    const former = await prisma.user.findUniqueOrThrow({ where: { id: originalOwnerId } });
    const successorToken = token(eligibleA, 'super_admin');
    const suspended = await call(
      'POST',
      `/admin/users/${originalOwnerId}/suspend`,
      successorToken,
      { version: former.version, reason: 'former owner lifecycle proof' },
    );
    expect(suspended.status).toBe(200);
    const version = (suspended.body.data?.['version'] as number | undefined) ?? former.version + 1;
    expect(
      (
        await call(
          'POST',
          `/admin/users/${originalOwnerId}/reactivate`,
          successorToken,
          { version },
        )
      ).status,
    ).toBe(200);
    expect((await transfer(originalOwnerId, successorToken)).status).toBe(200);
  });

  it('binds the pre-provisioned owner on first verified Google identity without registration', async () => {
    const existingIdentity = await prisma.userIdentity.findFirst({
      where: {
        userId: originalOwnerId,
        provider: 'google',
        email: 'safae.elmessoussi@gmail.com',
      },
      select: { providerSubjectId: true },
    });
    const providerSubjectId = `${TAG}:google-subject`;
    try {
      const route = await resolveLogin(prisma, {
        email: 'safae.elmessoussi@gmail.com',
        providerSubjectId: existingIdentity?.providerSubjectId ?? providerSubjectId,
      });
      expect(route.kind).toBe('active');
      if (route.kind === 'active') {
        expect(route.boundNow).toBe(existingIdentity === null);
        expect(route.account.user.id).toBe(originalOwnerId);
      }
      expect(
        await prisma.userIdentity.count({
          where: {
            userId: originalOwnerId,
            providerSubjectId: existingIdentity?.providerSubjectId ?? providerSubjectId,
          },
        }),
      ).toBe(1);
    } finally {
      if (existingIdentity === null) {
        await prisma.auditLog.deleteMany({
          where: { targetId: originalOwnerId, actionType: 'auth.identity_bound' },
        });
        await prisma.userIdentity.deleteMany({
          where: { userId: originalOwnerId, providerSubjectId },
        });
      }
    }
  });
});

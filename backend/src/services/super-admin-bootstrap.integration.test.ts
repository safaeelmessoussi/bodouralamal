import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  bootstrapSuperAdmin,
  INITIAL_PLATFORM_OWNER,
} from '../../prisma/seed/super-admin.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';

/**
 * Platform Owner bootstrap is tested against the real production-seeded
 * integration database without parking, suspending, or deleting its owner.
 * Those old fixture techniques are now correctly rejected by the invariant
 * being tested. Initial absent-database creation is exercised by the fresh
 * production-seed drill; this file pins the durable post-bootstrap contract.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = `[platform-owner-seed:${randomUUID()}]`;

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length > 0) {
    await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe('Platform Owner production bootstrap', () => {
  it('creates the exact approved unbound owner profile and global authority', async () => {
    const owner = await prisma.platformOwner.findUniqueOrThrow({
      where: { singletonKey: 'platform' },
      include: {
        ownerUser: {
          include: {
            identities: true,
            framingPreference: { include: { branches: true } },
            availability: true,
            branchRoles: {
              where: { deletedAt: null },
              include: { role: true },
            },
          },
        },
      },
    });

    expect(owner.ownerUser).toMatchObject({
      nameArabic: INITIAL_PLATFORM_OWNER.nameArabic,
      firstNameArabic: INITIAL_PLATFORM_OWNER.firstNameArabic,
      lastNameArabic: INITIAL_PLATFORM_OWNER.lastNameArabic,
      sex: INITIAL_PLATFORM_OWNER.sex,
      accountStatus: 'active',
      deletedAt: null,
      preProvisionedEmail: INITIAL_PLATFORM_OWNER.email,
    });
    /**
     * **Bootstrap fabricates no Google binding** — the property, asserted so it
     * survives the Owner actually signing in (test isolation, 2026-09-02).
     *
     * This read `identities).toEqual([])`, which stops being a statement about
     * bootstrap the first time somebody logs in: on a development or production
     * database that has been used, a bound identity is the CORRECT state and the
     * assertion failed on legitimate data.
     *
     * An identity created in the bootstrap transaction would carry the account's
     * own creation timestamp; one bound by a real sign-in is strictly later. So
     * the distinction the assertion was reaching for is checked directly, and it
     * holds however many times the Owner has since signed in.
     */
    for (const identity of owner.ownerUser.identities) {
      expect(
        identity.createdAt.getTime(),
        'a bootstrap-fabricated identity would share the account creation instant',
      ).toBeGreaterThan(owner.ownerUser.createdAt.getTime());
    }
    expect(owner.ownerUser.availability).toEqual([]);
    expect(owner.ownerUser.framingPreference).toMatchObject({ mode: 'both', allBranches: true });
    expect(owner.ownerUser.framingPreference?.branches).toEqual([]);
    expect(
      owner.ownerUser.branchRoles.filter(
        (assignment) =>
          assignment.role.name === 'super_admin' &&
          assignment.branchId === null &&
          assignment.userStatus === 'active',
      ),
    ).toHaveLength(1);
  });

  it('is an idempotent no-op after ownership exists, even with absent or wrong config', async () => {
    const before = await prisma.platformOwner.findUniqueOrThrow({
      where: { singletonKey: 'platform' },
    });
    const ownerCount = await prisma.platformOwner.count();
    const userCount = await prisma.user.count();

    await expect(bootstrapSuperAdmin(prisma, INITIAL_PLATFORM_OWNER.email)).resolves.toBeUndefined();
    await expect(bootstrapSuperAdmin(prisma, undefined)).resolves.toBeUndefined();
    await expect(bootstrapSuperAdmin(prisma, 'must-not-steal@example.invalid')).resolves.toBeUndefined();

    expect(await prisma.platformOwner.findUniqueOrThrow({ where: { singletonKey: 'platform' } }))
      .toEqual(before);
    expect(await prisma.platformOwner.count()).toBe(ownerCount);
    expect(await prisma.user.count()).toBe(userCount);
  });

  it('never steals ownership back after a legitimate transfer', async () => {
    const original = await prisma.platformOwner.findUniqueOrThrow({
      where: { singletonKey: 'platform' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
    const successor = await prisma.user.create({
      data: {
        nameArabic: `${TAG} خليفة`,
        sex: 'female',
        accountStatus: 'active',
        branchRoles: {
          create: { roleId: role.id, branchId: null, userStatus: 'active' },
        },
      },
    });

    try {
      await prisma.platformOwner.update({
        where: { singletonKey: 'platform' },
        data: { ownerUserId: successor.id, version: { increment: 1 } },
      });
      await bootstrapSuperAdmin(prisma, INITIAL_PLATFORM_OWNER.email);
      expect(
        (await prisma.platformOwner.findUniqueOrThrow({ where: { singletonKey: 'platform' } }))
          .ownerUserId,
      ).toBe(successor.id);
    } finally {
      await prisma.platformOwner.update({
        where: { singletonKey: 'platform' },
        // Restore the borrowed singleton exactly, including its logical
        // version. Incrementing again returned the relationship but still
        // changed shared seed state, which the all-table digest correctly
        // treats as a leak.
        data: { ownerUserId: original.ownerUserId, version: original.version },
      });
    }
  });
});

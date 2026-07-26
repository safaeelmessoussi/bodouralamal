import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootstrapSuperAdmin } from '../../prisma/seed/super-admin.js';
import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';

/**
 * §15.1 Super Admin bootstrap (Revision 22).
 *
 * `SUPER_ADMIN_EMAIL` is a bootstrap value: consulted only while no active Super
 * Administrator exists, ignored permanently afterwards. The old gate matched on
 * the email itself, which was idempotent only while the env var never changed —
 * editing it created a SECOND Super Admin and left the previous one active,
 * privileged and unclaimed. These tests pin the new gate against a real database.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[sa-boot-test]';

/** The seeded production Super Admin must not interfere, and must survive. */
let parkedIds: string[] = [];

async function superAdminRoleId(): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: 'super_admin' } });
  return role!.id;
}

async function activeSuperAdmins(): Promise<string[]> {
  const rows = await prisma.userBranchRole.findMany({
    where: {
      roleId: await superAdminRoleId(),
      deletedAt: null,
      user: { accountStatus: 'active', deletedAt: null },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { OR: [{ nameArabic: { startsWith: TAG } }, { preProvisionedEmail: { contains: 'sa-boot-' } }] },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: ids } }, { actorUserId: { in: ids } }] },
  });
  await prisma.userIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/**
 * The gate is global ("does ANY active Super Administrator exist"), so a
 * pre-existing seeded Super Admin would mask every test. Park it by suspending
 * it, and restore it afterwards — the test must not damage real seed data.
 *
 * This MUST be beforeAll, not beforeEach: capturing per-test overwrote the list
 * with an empty one after the first test, so afterAll restored nothing and left
 * the real Super Admin suspended. Park once, restore once.
 */
beforeAll(async () => {
  await clear();
  parkedIds = await activeSuperAdmins();
  if (parkedIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: parkedIds } },
      data: { accountStatus: 'suspended' },
    });
  }
});

beforeEach(async () => {
  await clear();
});

afterAll(async () => {
  await clear();
  if (parkedIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: parkedIds } },
      data: { accountStatus: 'active' },
    });
    // Assert the restore rather than trusting it: leaving the real Super Admin
    // suspended is exactly the damage this parking is supposed to avoid.
    const restored = await activeSuperAdmins();
    for (const id of parkedIds) {
      if (!restored.includes(id)) {
        throw new Error(`FAILED TO RESTORE parked Super Admin ${id} — it is still not active`);
      }
    }
  }
  await prisma.$disconnect();
});

describe('§15.1 Revision 22 — SUPER_ADMIN_EMAIL is a bootstrap value', () => {
  it('creates the initial Super Admin when none exists, unbound until first login', async () => {
    await bootstrapSuperAdmin(prisma, 'sa-boot-first@example.com');

    const created = await prisma.user.findFirst({
      where: { preProvisionedEmail: 'sa-boot-first@example.com' },
    });
    expect(created?.accountStatus).toBe('active');
    expect(await activeSuperAdmins()).toEqual([created!.id]);
    // §7 forbids stub identities: the binding happens on first Google login.
    expect(await prisma.userIdentity.count({ where: { userId: created!.id } })).toBe(0);
  });

  it('lowercases the address, so a capitalised .env value stays claimable', async () => {
    await bootstrapSuperAdmin(prisma, '  SA-Boot-Caps@Example.COM  ');
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: 'sa-boot-caps@example.com' } }),
    ).toBe(1);
  });

  it('is a NO-OP once an active Super Admin exists — even under a different email', async () => {
    await bootstrapSuperAdmin(prisma, 'sa-boot-original@example.com');
    const first = await activeSuperAdmins();
    expect(first).toHaveLength(1);

    // This is the exact scenario the old gate got wrong: the operator edits
    // SUPER_ADMIN_EMAIL and re-runs the seed.
    await bootstrapSuperAdmin(prisma, 'sa-boot-changed@example.com');

    expect(await activeSuperAdmins()).toEqual(first);
    // No second privileged account, and the new address was never written.
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: 'sa-boot-changed@example.com' } }),
    ).toBe(0);
  });

  it('is idempotent: re-running with the SAME email adds nothing', async () => {
    await bootstrapSuperAdmin(prisma, 'sa-boot-same@example.com');
    await bootstrapSuperAdmin(prisma, 'sa-boot-same@example.com');
    await bootstrapSuperAdmin(prisma, 'sa-boot-same@example.com');

    expect(await activeSuperAdmins()).toHaveLength(1);
    expect(
      await prisma.userBranchRole.count({
        where: { roleId: await superAdminRoleId(), user: { preProvisionedEmail: 'sa-boot-same@example.com' } },
      }),
    ).toBe(1);
  });

  it('GRANTS the role to an existing account for that address rather than duplicating it', async () => {
    // An ordinary member who already logged in — the address lives on a bound
    // UserIdentity, not on pre_provisioned_email.
    const member = await prisma.user.create({
      data: { nameArabic: `${TAG} عضوة`, accountStatus: 'active' },
    });
    await prisma.userIdentity.create({
      data: {
        userId: member.id,
        provider: 'google',
        providerSubjectId: `sa-boot-sub-${Date.now()}`,
        email: 'sa-boot-member@example.com',
      },
    });

    await bootstrapSuperAdmin(prisma, 'sa-boot-member@example.com');

    expect(await activeSuperAdmins()).toEqual([member.id]);
    // Not duplicated into a second account holding the same address.
    expect(
      await prisma.user.count({ where: { preProvisionedEmail: 'sa-boot-member@example.com' } }),
    ).toBe(0);
  });

  it('ACTIVATES a matched non-active account, so bootstrap yields a usable admin', async () => {
    // A suspended admin would be no admin at all: TD-12's freshness check
    // refuses any caller who is not Active.
    const suspended = await prisma.user.create({
      data: {
        nameArabic: `${TAG} موقوفة`,
        accountStatus: 'suspended',
        preProvisionedEmail: 'sa-boot-suspended@example.com',
      },
    });

    await bootstrapSuperAdmin(prisma, 'sa-boot-suspended@example.com');

    expect((await prisma.user.findUnique({ where: { id: suspended.id } }))?.accountStatus).toBe('active');
    expect(await activeSuperAdmins()).toEqual([suspended.id]);
  });

  it('REFUSES to resurrect a soft-deleted holder, and creates nothing', async () => {
    const deleted = await prisma.user.create({
      data: {
        nameArabic: `${TAG} محذوفة`,
        accountStatus: 'active',
        preProvisionedEmail: 'sa-boot-deleted@example.com',
        deletedAt: new Date(),
      },
    });

    await expect(bootstrapSuperAdmin(prisma, 'sa-boot-deleted@example.com')).rejects.toThrow(
      /soft-deleted account/,
    );

    // §4.1 forbids silent reactivation, and no parallel account may appear —
    // the TD-6 partial unique index spans deleted rows, so one would break it.
    expect((await prisma.user.findUnique({ where: { id: deleted.id } }))?.deletedAt).not.toBeNull();
    expect(
      await prisma.user.count({
        where: { preProvisionedEmail: 'sa-boot-deleted@example.com', deletedAt: null },
      }),
    ).toBe(0);
    expect(await activeSuperAdmins()).toHaveLength(0);
  });

  it('reopens the gate when every Super Admin is suspended — the recovery path', async () => {
    await bootstrapSuperAdmin(prisma, 'sa-boot-lockout@example.com');
    const [first] = await activeSuperAdmins();

    // Simulate the lockout: the only administrator is suspended.
    await prisma.user.update({ where: { id: first! }, data: { accountStatus: 'suspended' } });
    expect(await activeSuperAdmins()).toHaveLength(0);

    await bootstrapSuperAdmin(prisma, 'sa-boot-recovered@example.com');

    const recovered = await activeSuperAdmins();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).not.toBe(first);
  });

  it('a soft-deleted Super Admin does not hold the gate open', async () => {
    await bootstrapSuperAdmin(prisma, 'sa-boot-gone@example.com');
    const [first] = await activeSuperAdmins();
    await prisma.user.update({ where: { id: first! }, data: { deletedAt: new Date() } });

    await bootstrapSuperAdmin(prisma, 'sa-boot-successor@example.com');
    expect(await activeSuperAdmins()).toHaveLength(1);
  });

  it('a REVOKED role assignment does not hold the gate open', async () => {
    await bootstrapSuperAdmin(prisma, 'sa-boot-revoked@example.com');
    const [first] = await activeSuperAdmins();
    // The account stays Active but loses the role — it is no longer an admin.
    await prisma.userBranchRole.updateMany({
      where: { userId: first! },
      data: { deletedAt: new Date() },
    });

    await bootstrapSuperAdmin(prisma, 'sa-boot-after-revoke@example.com');
    expect(await activeSuperAdmins()).toHaveLength(1);
  });
});

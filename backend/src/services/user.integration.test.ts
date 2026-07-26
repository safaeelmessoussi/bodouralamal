import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import * as userRepo from '../repositories/user.repository.js';
import { preProvision } from './user.service.js';

/**
 * Staff pre-provisioning (§3.1, §4.1b step 4b, §5.6, §7 Revision 15).
 *
 * The property that matters is not "a row was written" — it is that the account
 * is **claimable by exactly one Google address and by nobody else**, and that it
 * carries **no identity** until that address logs in. Both are asserted through
 * the same repository the login flow uses, so these tests exercise the real
 * resolution path rather than a parallel one.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[preprov-test]';

let seq = 0;
const addr = () => {
  seq += 1;
  return `preprov-${Date.now()}-${seq}@example.com`;
};

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

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      OR: [{ nameArabic: { startsWith: TAG } }, { preProvisionedEmail: { startsWith: 'preprov-' } }],
    },
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

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.1b step 4b — staff pre-provisioning', () => {
  it('creates a claimable account with NO identity row (§7 forbids placeholders)', async () => {
    const admin = await makeStaff('admin');
    const email = addr();

    const created = await preProvision(prisma, admin, { nameArabic: `${TAG} معلمة`, email });

    expect(created.accountStatus).toBe('pending');
    expect(created.preProvisionedEmail).toBe(email);
    // The account exists but nobody has authenticated as it yet. A stub identity
    // here would break the "has an identity ⇒ has authenticated" predicate.
    expect(await prisma.userIdentity.count({ where: { userId: created.id } })).toBe(0);
  });

  it('is findable by the LOGIN path\'s own lookup, which is what makes it claimable', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    const created = await preProvision(prisma, admin, { nameArabic: `${TAG} معلمة`, email });

    // Exercised through the repository §4.1b step 3.2 actually calls.
    const resolved = await userRepo.findByPreProvisionedEmail(prisma, email);
    expect(resolved?.user.id).toBe(created.id);
  });

  it('binds on first login and then resolves by identity forever after (TD-4.10)', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    const created = await preProvision(prisma, admin, { nameArabic: `${TAG} معلمة`, email });
    const subject = `preprov-sub-${Date.now()}`;

    // First login: the fallback finds it, then the binding is created.
    await userRepo.bindIdentity(prisma, {
      userId: created.id,
      provider: 'google',
      providerSubjectId: subject,
      email,
    });

    // Every later login resolves at step 3.1 by provider identity.
    const byIdentity = await userRepo.findByProviderIdentity(prisma, 'google', subject);
    expect(byIdentity?.user.id).toBe(created.id);

    // §7: the column is RETAINED, not cleared, so provenance survives and the
    // address cannot be handed to a second account afterwards.
    const after = await prisma.user.findUnique({ where: { id: created.id } });
    expect(after?.preProvisionedEmail).toBe(email);
    await expect(
      preProvision(prisma, admin, { nameArabic: `${TAG} منتحلة`, email }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('lowercases the address, so a capitalised entry is still claimable (TD-12)', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    const created = await preProvision(prisma, admin, {
      nameArabic: `${TAG} معلمة`,
      email: `  ${email.toUpperCase()}  `,
    });

    expect(created.preProvisionedEmail).toBe(email);
    // Google returns the address lowercased, so this is what first login sees.
    expect(await userRepo.findByPreProvisionedEmail(prisma, email)).not.toBeNull();
  });

  it('refuses a second account for the same address (TD-6 partial unique index)', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    await preProvision(prisma, admin, { nameArabic: `${TAG} الأولى`, email });

    await expect(
      preProvision(prisma, admin, { nameArabic: `${TAG} الثانية`, email }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
    expect(await prisma.user.count({ where: { preProvisionedEmail: email } })).toBe(1);
  });

  it('will not silently reclaim a SOFT-DELETED account\'s address', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    const first = await preProvision(prisma, admin, { nameArabic: `${TAG} مغادرة`, email });
    await prisma.user.update({ where: { id: first.id }, data: { deletedAt: new Date() } });

    // The TD-6 index spans deleted rows, so the address stays spoken for —
    // §4.1 forbids a deleted person being silently re-created.
    await expect(
      preProvision(prisma, admin, { nameArabic: `${TAG} أخرى`, email }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('assigns a role and branch scope in the same transaction', async () => {
    const admin = await makeStaff('admin');
    const branch = await prisma.branch.create({
      data: { name: `${TAG} فرع`, operationalStartDate: new Date('2026-01-01') },
    });

    const created = await preProvision(prisma, admin, {
      nameArabic: `${TAG} معلمة`,
      email: addr(),
      role: 'teacher',
      branchId: branch.id,
    });

    const assignment = await prisma.userBranchRole.findFirst({
      where: { userId: created.id },
      include: { role: true },
    });
    expect(assignment?.role.name).toBe('teacher');
    expect(assignment?.branchId).toBe(branch.id);

    await prisma.userBranchRole.deleteMany({ where: { userId: created.id } });
    await prisma.user.deleteMany({ where: { id: created.id } });
    await prisma.branch.delete({ where: { id: branch.id } });
  });

  it('rejects an unknown branch scope, creating nothing', async () => {
    const admin = await makeStaff('admin');
    const email = addr();

    await expect(
      preProvision(prisma, admin, {
        nameArabic: `${TAG} معلمة`,
        email,
        role: 'teacher',
        branchId: '11111111-2222-4333-8444-555555555555',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // The whole thing is one transaction: no orphan user may survive.
    expect(await prisma.user.count({ where: { preProvisionedEmail: email } })).toBe(0);
  });

  it('§4.1b 4b: pre_approved yields Active, default yields Pending', async () => {
    const admin = await makeStaff('admin');
    const pending = await preProvision(prisma, admin, { nameArabic: `${TAG} أ`, email: addr() });
    const active = await preProvision(prisma, admin, {
      nameArabic: `${TAG} ب`,
      email: addr(),
      preApproved: true,
    });

    expect(pending.accountStatus).toBe('pending');
    expect(active.accountStatus).toBe('active');
  });

  it('TD-2: a teacher cannot pre-provision', async () => {
    const teacher = await makeStaff('teacher');
    const email = addr();
    await expect(
      preProvision(prisma, teacher, { nameArabic: `${TAG} معلمة`, email }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.user.count({ where: { preProvisionedEmail: email } })).toBe(0);
  });

  it('an Admin cannot create another Admin; a Super Admin can', async () => {
    const admin = await makeStaff('admin');
    const superAdmin = await makeStaff('super_admin');

    await expect(
      preProvision(prisma, admin, { nameArabic: `${TAG} مشرفة`, email: addr(), role: 'admin' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const created = await preProvision(prisma, superAdmin, {
      nameArabic: `${TAG} مشرفة`,
      email: addr(),
      role: 'admin',
    });
    expect(created.id).toBeTruthy();
  });

  it('TD-12: an admin suspended mid-session cannot pre-provision', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    await prisma.user.update({ where: { id: admin }, data: { accountStatus: 'suspended' } });

    await expect(
      preProvision(prisma, admin, { nameArabic: `${TAG} معلمة`, email }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.user.count({ where: { preProvisionedEmail: email } })).toBe(0);
  });

  it('writes an attributable audit row', async () => {
    const admin = await makeStaff('admin');
    const email = addr();
    const created = await preProvision(prisma, admin, {
      nameArabic: `${TAG} معلمة`,
      email,
      role: 'teacher',
    });

    const row = await prisma.auditLog.findFirst({
      where: { targetId: created.id, actionType: 'user.create' },
    });
    expect(row?.actorUserId).toBe(admin);
    const detail = row!.detail as Record<string, unknown>;
    expect(detail['pre_provisioned_email']).toBe(email);
    expect(detail['role']).toBe('teacher');
  });
});

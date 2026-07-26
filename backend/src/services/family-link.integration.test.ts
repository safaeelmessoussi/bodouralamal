import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient } from '../lib/prisma.js';
import { resolveActingStudent } from '../middleware/child-context.js';
import { revokeLink } from './family-link.service.js';

/**
 * FamilyLink revocation (§4.3 Revision 16) against the real database.
 *
 * The property that matters is not "the row got a `deleted_at`" — it is that the
 * parent's access is gone on the very NEXT request. So these tests assert the
 * revocation through the same resolver the child-scoped endpoints will use,
 * rather than trusting the column.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);
const TAG = '[fam-link-test]';

async function makeUser(label: string, status = 'active'): Promise<string> {
  const user = await prisma.user.create({
    data: { nameArabic: `${TAG} ${label}`, accountStatus: status as never },
  });
  return user.id;
}

async function makeStaff(role: string): Promise<string> {
  const id = await makeUser(role);
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  await prisma.userBranchRole.create({
    data: { userId: id, roleId: roleRow!.id, branchId: null },
  });
  return id;
}

async function approvedLink(parentId: string, studentId: string): Promise<string> {
  const row = await prisma.familyLink.create({
    data: { parentId, studentId, status: 'approved', decidedAt: new Date() },
  });
  return row.id;
}

async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const links = await prisma.familyLink.findMany({
    where: { OR: [{ parentId: { in: ids } }, { studentId: { in: ids } }] },
    select: { id: true },
  });
  const linkIds = links.map((l) => l.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: [...ids, ...linkIds] } }, { actorUserId: { in: ids } }] },
  });
  await prisma.trash.deleteMany({
    where: { OR: [{ targetId: { in: linkIds } }, { deletedById: { in: ids } }] },
  });
  await prisma.familyLink.deleteMany({ where: { id: { in: linkIds } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  await prisma.$disconnect();
});

describe('§4.3 Revision 16 — revoking an approved link', () => {
  it('cuts the parent off on the very NEXT request, with no token change', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);

    // Access works before revocation.
    await expect(resolveActingStudent(prisma, { userId: p, roles: ['parent'] }, c)).resolves
      .toMatchObject({ studentId: c });

    await revokeLink(prisma, admin, linkId, 'انتقال الحضانة');

    // Nothing about the parent's session changed — only the link row.
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ['parent'] }, c),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('TD-4.8: soft-delete + Trash snapshot + audit, all present', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);

    await revokeLink(prisma, admin, linkId, 'بناء على طلب الأسرة');

    const link = await prisma.familyLink.findUnique({ where: { id: linkId } });
    expect(link?.deletedAt).not.toBeNull();
    expect(link?.deletedById).toBe(admin);
    // TD-1: Approved stays terminal — revocation is the delete, not a new status.
    expect(link?.status).toBe('approved');

    const trash = await prisma.trash.findFirst({ where: { targetId: linkId } });
    expect(trash?.targetEntity).toBe('FamilyLink');
    expect(trash?.purgeAfter).not.toBeNull();

    const row = await prisma.auditLog.findFirst({
      where: { targetId: linkId, actionType: 'familylink.revoke' },
    });
    expect(row).not.toBeNull();
    expect(row!.actorUserId).toBe(admin);
    // §7 attribution invariant: who/when/why reconstructable from the audit row
    // alone, without reading the soft-deleted link.
    const detail = row!.detail as Record<string, unknown>;
    expect(detail['parent_id']).toBe(p);
    expect(detail['student_id']).toBe(c);
    expect(detail['reason']).toBe('بناء على طلب الأسرة');
  });

  it('TD-6: the same pair can be linked again afterwards as a fresh Pending row', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);
    await revokeLink(prisma, admin, linkId, 'خطأ إداري');

    // The partial unique index covers non-deleted rows only, so this must not
    // collide with the revoked row.
    const fresh = await prisma.familyLink.create({
      data: { parentId: p, studentId: c, status: 'pending' },
    });
    expect(fresh.status).toBe('pending');
    // And a fresh Pending link grants nothing until approved (BR-4).
    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ['parent'] }, c),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a reason is required', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);

    await expect(revokeLink(prisma, admin, linkId, '   ')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // Nothing revoked — the parent still has access.
    await expect(resolveActingStudent(prisma, { userId: p, roles: ['parent'] }, c)).resolves
      .toMatchObject({ studentId: c });
  });

  it('revoking twice is NOT_FOUND the second time, and writes one audit row', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);

    await revokeLink(prisma, admin, linkId, 'مرة واحدة');
    await expect(revokeLink(prisma, admin, linkId, 'مرة ثانية')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await prisma.auditLog.count({ where: { targetId: linkId, actionType: 'familylink.revoke' } }),
    ).toBe(1);
  });

  it('a PENDING link cannot be revoked — it is decided in the approval queue', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const pending = await prisma.familyLink.create({
      data: { parentId: p, studentId: c, status: 'pending' },
    });

    await expect(revokeLink(prisma, admin, pending.id, 'خطأ')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect((await prisma.familyLink.findUnique({ where: { id: pending.id } }))?.deletedAt).toBeNull();
  });

  it('TD-2: a teacher cannot revoke, and a parent cannot revoke their own link', async () => {
    const teacher = await makeStaff('teacher');
    const p = await makeStaff('parent');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);

    await expect(revokeLink(prisma, teacher, linkId, 'محاولة')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(revokeLink(prisma, p, linkId, 'محاولة')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await prisma.familyLink.findUnique({ where: { id: linkId } }))?.deletedAt).toBeNull();
  });

  it('TD-12: an admin suspended mid-session cannot revoke on a valid token', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c = await makeUser('طفلة');
    const linkId = await approvedLink(p, c);

    await prisma.user.update({ where: { id: admin }, data: { accountStatus: 'suspended' } });

    await expect(revokeLink(prisma, admin, linkId, 'محاولة')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await prisma.familyLink.findUnique({ where: { id: linkId } }))?.deletedAt).toBeNull();
  });

  it('revoking one child\'s link leaves the parent\'s OTHER children untouched', async () => {
    const admin = await makeStaff('admin');
    const p = await makeUser('والدة');
    const c1 = await makeUser('طفلة أ');
    const c2 = await makeUser('طفلة ب');
    const link1 = await approvedLink(p, c1);
    await approvedLink(p, c2);

    await revokeLink(prisma, admin, link1, 'حالة واحدة فقط');

    await expect(
      resolveActingStudent(prisma, { userId: p, roles: ['parent'] }, c1),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(resolveActingStudent(prisma, { userId: p, roles: ['parent'] }, c2)).resolves
      .toMatchObject({ studentId: c2 });
  });

  it('revoking one parent\'s link leaves the OTHER parent of the same child untouched', async () => {
    const admin = await makeStaff('admin');
    const p1 = await makeUser('والدة');
    const p2 = await makeUser('والد');
    const c = await makeUser('طفلة');
    const link1 = await approvedLink(p1, c);
    await approvedLink(p2, c);

    await revokeLink(prisma, admin, link1, 'أحد الوالدين فقط');

    await expect(
      resolveActingStudent(prisma, { userId: p1, roles: ['parent'] }, c),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(resolveActingStudent(prisma, { userId: p2, roles: ['parent'] }, c)).resolves
      .toMatchObject({ studentId: c });
  });
});

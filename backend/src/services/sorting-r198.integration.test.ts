import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';
import type { Actor } from '../policies/actor.js';
import { ASSESSMENT_SORT_FIELDS, listAssessments } from './assessment.service.js';
import { GROUP_SORT_FIELDS, listAdministrativeGroups } from './administrative-group.service.js';
import { BRANCH_SORT_FIELDS, listBranches } from './branch.service.js';
import { listLibrary } from './library.service.js';
import { listAllTeachingGroups, TEACHING_GROUP_SORT_FIELDS } from './teaching-group.service.js';
import { listTrash, TRASH_SORT_FIELDS } from './trash.service.js';
import { listUsers, USER_SORT_FIELDS } from './user.service.js';

/**
 * **SRS Revision 198 §6 — every header sorts** (the Owner, 2026-10-04).
 *
 * Each allow-list builds a Prisma `orderBy` that is cast past the type checker
 * (`as never`), so a shape PostgreSQL or Prisma refuses — `nulls` on a
 * required column, a `_count` on the wrong relation — would compile and fail
 * only when a reader clicks the header. Every field of every list is run here,
 * both ways, against the real database.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const TAG = '[sorting-r198-test]';

let actorUserId = '';
const superAdmin = (): Actor => ({
  userId: actorUserId,
  roles: ['super_admin'],
  roleScopes: [{ role: 'super_admin', branches: null }],
  activeRole: 'super_admin',
});

beforeAll(async () => {
  actorUserId = (
    await prisma.user.create({
      data: { nameArabic: `${TAG} مشرفة`, sex: 'female', accountStatus: 'active' },
    })
  ).id;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  await prisma.userBranchRole.create({ data: { userId: actorUserId, roleId: role.id, branchId: null } });
});

afterAll(async () => {
  await prisma.userBranchRole.deleteMany({ where: { userId: actorUserId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId } });
  await prisma.user.deleteMany({ where: { id: actorUserId } });
  await prisma.$disconnect();
});

const DIRS = ['asc', 'desc'] as const;

describe('R198 §6 — every sort field runs against PostgreSQL, both ways', () => {
  it('الفروع', async () => {
    for (const sortBy of Object.keys(BRANCH_SORT_FIELDS))
      for (const sortDir of DIRS) await expect(listBranches(prisma, superAdmin(), { sortBy, sortDir })).resolves.toBeDefined();
  });

  it('مجموعات المستويات', async () => {
    for (const sortBy of Object.keys(GROUP_SORT_FIELDS))
      for (const sortDir of DIRS)
        await expect(listAdministrativeGroups(prisma, superAdmin(), { sortBy, sortDir })).resolves.toBeDefined();
  });

  it('حلقات المواد', async () => {
    for (const sortBy of Object.keys(TEACHING_GROUP_SORT_FIELDS))
      for (const sortDir of DIRS)
        await expect(listAllTeachingGroups(prisma, superAdmin(), { sortBy, sortDir } as never)).resolves.toBeDefined();
  });

  it('المستخدمون', async () => {
    for (const sortBy of Object.keys(USER_SORT_FIELDS))
      for (const sortDir of DIRS) await expect(listUsers(prisma, superAdmin(), { sortBy, sortDir })).resolves.toBeDefined();
  });

  it('سلة المحذوفات', async () => {
    for (const sortBy of Object.keys(TRASH_SORT_FIELDS))
      for (const sortDir of DIRS) await expect(listTrash(prisma, superAdmin(), { sortBy, sortDir })).resolves.toBeDefined();
  });

  it('بناء الاختبارات', async () => {
    for (const sortBy of Object.keys(ASSESSMENT_SORT_FIELDS))
      for (const sortDir of DIRS)
        await expect(listAssessments(prisma, superAdmin(), { sortBy, sortDir })).resolves.toBeDefined();
  });

  it('مكتبة المحتوى — kind and visibility too', async () => {
    const reader = { ...superAdmin(), accountStatus: 'active' } as never;
    for (const sortBy of ['title', 'published', 'size', 'branch', 'kind', 'visibility'])
      for (const sortDir of DIRS) await expect(listLibrary(prisma, reader, { sortBy, sortDir })).resolves.toBeDefined();
  });

  it('a status sorts by the account’s life, not the alphabet', async () => {
    const page = await listUsers(prisma, superAdmin(), { sortBy: 'status', sortDir: 'asc', pageSize: 100 });
    const order = ['pending', 'active', 'rejected', 'suspended'];
    const seen = page.data.map((u) => order.indexOf((u as { accountStatus: string }).accountStatus));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

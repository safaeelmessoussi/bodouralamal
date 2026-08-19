/**
 * The R82 scenario: two beneficiaries in different Levels, Categories and
 * Branches, plus events addressed to each scope shape (§4.8, R82).
 *
 * Built here rather than driven through the forms because the harness verifies
 * **notification audiences and personal calendars**, not the scheduling form —
 * and re-driving that form each run would make a failure ambiguous between two
 * features. It prints the ids the harness needs and `--clean` removes them.
 */
import { createPrismaClient } from '../src/lib/prisma.js';

const TAG = '[r82-browser]';
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const prisma = createPrismaClient(url);

async function wipe(): Promise<void> {
  const events = await prisma.event.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  await prisma.notification.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventBranch.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventCategory.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventLevel.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });

  const users = await prisma.user.findMany({
    where: { nameArabic: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.userBranchRole.deleteMany({ where: { userId: { in: ids } } });
  // The dev sessions minted for these people wrote `auth.refresh` audit rows,
  // and `AuditLog.actor_user_id` is RESTRICT — the trail outlives the fixture
  // deliberately, so teardown has to clear it explicitly.
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.level.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: TAG } } });
}

await wipe();
if (process.argv.includes('--clean')) {
  await prisma.$disconnect();
  process.exit(0);
}

const catA = await prisma.category.create({ data: { name: `${TAG} فئة أ`, displayOrder: 90 } });
const catB = await prisma.category.create({ data: { name: `${TAG} فئة ب`, displayOrder: 91 } });
const levelA = await prisma.level.create({
  data: { name: `${TAG} مستوى أ`, categoryId: catA.id, displayOrder: 1, genderRestriction: 'any' },
});
const levelB = await prisma.level.create({
  data: { name: `${TAG} مستوى ب`, categoryId: catB.id, displayOrder: 1, genderRestriction: 'any' },
});
const branchA = await prisma.branch.create({ data: { name: `${TAG} فرع أ` } });
const branchB = await prisma.branch.create({ data: { name: `${TAG} فرع ب` } });

async function student(label: string, levelId: string, branchId: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      nameArabic: `${TAG} ${label}`,
      sex: 'female',
      accountStatus: 'active',
      isBeneficiary: true,
    },
  });
  await prisma.enrollment.create({ data: { studentId: user.id, levelId, branchId } });
  return user.id;
}

const concerned = await student('المعنية', levelA.id, branchA.id);
const unrelated = await student('غير المعنية', levelB.id, branchB.id);

async function event(
  label: string,
  scopes: { branchIds?: string[]; categoryIds?: string[]; levelIds?: string[] },
): Promise<string> {
  const row = await prisma.event.create({
    data: {
      title: `${TAG} ${label}`,
      visibility: 'public',
      startDate: new Date('2026-08-25T00:00:00Z'),
      startTime: new Date('1970-01-01T10:00:00Z'),
      recurrenceType: 'none',
    },
    select: { id: true },
  });
  for (const branchId of scopes.branchIds ?? []) {
    await prisma.eventBranch.create({ data: { eventId: row.id, branchId } });
  }
  for (const categoryId of scopes.categoryIds ?? []) {
    await prisma.eventCategory.create({ data: { eventId: row.id, categoryId } });
  }
  for (const levelId of scopes.levelIds ?? []) {
    await prisma.eventLevel.create({ data: { eventId: row.id, levelId } });
  }
  return row.id;
}

const levelEvent = await event('نشاط المستوى أ', { levelIds: [levelA.id] });
const otherLevelEvent = await event('نشاط المستوى ب', { levelIds: [levelB.id] });
const branchCategoryEvent = await event('فرع أ + فئة أ', {
  branchIds: [branchA.id],
  categoryIds: [catA.id],
});
const categoryWideEvent = await event('فئة أ في كل الفروع', { categoryIds: [catA.id] });

console.log(
  JSON.stringify({
    concerned,
    unrelated,
    levelEvent,
    otherLevelEvent,
    branchCategoryEvent,
    categoryWideEvent,
  }),
);
await prisma.$disconnect();

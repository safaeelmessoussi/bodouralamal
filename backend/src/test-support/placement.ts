import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * A Level with one Administrative Group, for suites that must **approve**
 * somebody.
 *
 * §4.1 (Revision 43) makes placement part of approval rather than a later step —
 * *"an approved account with no enrollment is a person the platform admitted and
 * then lost"* — so every approval of a student now carries an
 * `administrative_group_id`. That turned a one-line `decide(… { approve: true })`
 * into something needing a curriculum behind it, in suites whose subject is the
 * decision machinery rather than the placement.
 *
 * This exists so that fixture is written **once**. A copy per suite is how the
 * §4.4b sex restriction ends up satisfied by accident in one file and by design
 * in another.
 *
 * **`gender_restriction: 'any'` deliberately.** These suites are not testing the
 * restriction — `enrollment.integration.test.ts` is — and a restricted Level here
 * would make every unrelated approval test depend on the fixture's `sex`.
 */
export interface Placement {
  branchId: string;
  levelId: string;
  groupId: string;
  categoryId: string;
}

export async function provisionPlacement(
  prisma: PrismaClient,
  tag: string,
): Promise<Placement> {
  const branch = await prisma.branch.create({ data: { name: `${tag} فرع` } });
  const category = await prisma.category.create({ data: { name: `${tag} فئة` } });
  const level = await prisma.level.create({
    data: { name: `${tag} مستوى`, categoryId: category.id, genderRestriction: 'any' },
  });
  const group = await prisma.administrativeGroup.create({
    data: { name: `${tag} المجموعة 1`, levelId: level.id, branchId: branch.id },
  });
  return {
    branchId: branch.id,
    levelId: level.id,
    groupId: group.id,
    categoryId: category.id,
  };
}

/**
 * Removes it, innermost first.
 *
 * Every FK here is `Restrict`, so the order is not a preference — a Level with a
 * live group cannot be deleted, and the failure would surface as a constraint
 * violation in `afterAll` rather than as anything readable.
 *
 * **Call this AFTER deleting the suite's users, never before.**
 * `User.intended_category_id` is `Restrict` too (R49), so a Category still named
 * by a pending applicant refuses to go — which is the constraint working, and
 * exactly what it exists to prevent in production. Calling it first cost nine
 * red tests that looked like a logic failure and were a teardown ordering bug.
 */
export async function clearPlacement(prisma: PrismaClient, tag: string): Promise<void> {
  // **Every Level pointing at this fixture's Categories, not only the ones it
  // named.** A suite that creates its own Level against a fixture Category —
  // R66.5's group-less placement test does — would otherwise hold the Category
  // under RESTRICT and take the whole teardown with it.
  const levels = await prisma.level.findMany({
    where: {
      OR: [{ name: { startsWith: tag } }, { category: { name: { startsWith: tag } } }],
    },
    select: { id: true },
  });
  const levelIds = levels.map((l) => l.id);
  await prisma.enrollment.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.administrativeGroup.deleteMany({ where: { levelId: { in: levelIds } } });
  await prisma.level.deleteMany({ where: { id: { in: levelIds } } });

  // R67 — a `ChildApplication` now names its OWN requested Category and Branch,
  // both `ON DELETE RESTRICT`. Before the revision only the applicant's `User`
  // row referenced them, so this fixture never had to sweep applications; now a
  // suite that submitted one blocks its own Category delete. Swept by the
  // fixture's rows rather than by tag, because an application carries no name.
  const categories = await prisma.category.findMany({
    where: { name: { startsWith: tag } },
    select: { id: true },
  });
  const branches = await prisma.branch.findMany({
    where: { name: { startsWith: tag } },
    select: { id: true },
  });
  await prisma.childApplication.deleteMany({
    where: {
      OR: [
        { requestedCategoryId: { in: categories.map((c) => c.id) } },
        { requestedBranchId: { in: branches.map((b) => b.id) } },
      ],
    },
  });

  await prisma.category.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.branch.deleteMany({ where: { name: { startsWith: tag } } });
}

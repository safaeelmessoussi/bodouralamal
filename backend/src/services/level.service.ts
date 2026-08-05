import type { Level, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import { assertNoBlockingReferences, updateWithVersion } from '../repositories/optimistic-lock.js';
import * as trash from '../repositories/trash.repository.js';
import type { Actor } from '../policies/actor.js';

/**
 * Level creation — **TD-4.6b, SRS Revision 43.1.**
 *
 * *"`Level` insert + its first `AdministrativeGroup` (**المجموعة 1**) at the
 * Branch supplied in the request + `AuditLog` row."*
 *
 * **Why the group is created in the same act rather than later.** A Level with
 * no Administrative Group is a Level nobody can be admitted to: the §4.1
 * approval flow asks the administrator to pick one group per selected Level and
 * would have nothing to offer. Creating it in the same transaction means that
 * state **never exists**, rather than existing until something fills it in —
 * which is precisely the difference Revision 43.1 was issued to make.
 *
 * **The Branch is an INPUT, not a column on `Level`** (§4.4b). A Level stays
 * Category-scoped and branch-independent, and may hold groups at several
 * branches; what this asks is *where the first group sits*, and that answer is
 * stored on the group. Adding `branch_id` to `Level` would make a Level
 * branch-local and break `entire_level` teaching mode, which resolves a Level's
 * students **across** the groups at one branch (§4.4c).
 *
 * **Levels are reference data: Super Admin only** (§5.6, Revision 26). The
 * group this creates is operational data an Admin may later manage, which is not
 * a contradiction — Super Admin is unscoped and may act anywhere.
 *
 * **Reading is Admin and above, writing is Super Admin** (TD-2 R26) — the rule
 * every piece of curriculum reference data follows. See
 * `taxonomy.service.ts` for the Categories and Subjects a Level names.
 */

/** §7: the name every Level's first group is given. Arabic, matching the
 *  platform's structural-entity convention (§2.2) — never "Group 1". */
export const FIRST_GROUP_NAME = 'المجموعة 1';

export interface CreateLevelInput {
  name: string;
  categoryId: string;
  genderRestriction: 'any' | 'girls_only' | 'boys_only';
  displayOrder?: number | null;
  /**
   * **Required (Revision 43.1).** Where المجموعة 1 sits. Not stored on the
   * Level — see the note above.
   */
  branchId: string;
}

export interface CreatedLevel {
  level: Level;
  firstGroup: { id: string; name: string; branchId: string };
}

function assertCanManageReferenceData(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'level management is Super Admin only');
  }
}

/** TD-2 R26: an Admin reads reference data — operational work depends on it. */
function assertCanReadReferenceData(actor: Actor): void {
  const permitted =
    scope.isSuperAdmin(actor.roleScopes) || scope.hasRole(actor.roleScopes, 'admin');
  if (!permitted) throw new AppError('FORBIDDEN', 'reading levels requires admin (TD-2 R26)');
}

/**
 * A Level as the back office needs to see it.
 *
 * **The counts are the whole point of this read.** A Level's name says nothing
 * about whether it can be edited or removed; `enrollmentCount` and
 * `groupCount` are what let the screen tell an administrator *before* they try.
 * The alternative — a request per row to find out — is the shape that makes a
 * list screen slow and a delete button a guess.
 */
export interface LevelSummary {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  genderRestriction: string;
  displayOrder: number | null;
  groupCount: number;
  subjectCount: number;
  enrollmentCount: number;
  version: number;
}

/**
 * Every live Level, in §2.2 order — **by Category first**, because the ordering
 * of Levels is scoped within their Category (§7) and a flat list ordered on
 * `display_order` alone would interleave two curricula.
 *
 * Unpaginated for the same reason the Subject selector is: the set is bounded
 * by the curriculum, and a Levels screen that hides its second page is a screen
 * that cannot answer "does this Level already exist".
 */
export async function listLevels(
  prisma: PrismaClient,
  actor: Actor,
  filters: { categoryId?: string } = {},
): Promise<LevelSummary[]> {
  assertCanReadReferenceData(actor);

  const rows = await prisma.level.findMany({
    where: { deletedAt: null, ...(filters.categoryId ? { categoryId: filters.categoryId } : {}) },
    orderBy: [
      { category: { displayOrder: { sort: 'asc', nulls: 'last' } } },
      { category: { name: 'asc' } },
      { displayOrder: { sort: 'asc', nulls: 'last' } },
      { name: 'asc' },
      { id: 'asc' },
    ],
    select: {
      id: true,
      name: true,
      categoryId: true,
      genderRestriction: true,
      displayOrder: true,
      version: true,
      category: { select: { name: true } },
      _count: {
        select: {
          administrativeGroups: { where: { deletedAt: null } },
          subjects: { where: { deletedAt: null } },
          enrollments: { where: { deletedAt: null } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    genderRestriction: row.genderRestriction,
    displayOrder: row.displayOrder,
    groupCount: row._count.administrativeGroups,
    subjectCount: row._count.subjects,
    enrollmentCount: row._count.enrollments,
    version: row.version,
  }));
}

/**
 * Renames a Level, moves it in the ordering, or changes its sex restriction.
 *
 * **`category_id` is deliberately not editable.** Moving a Level between
 * Categories would silently re-file every enrolled student into a different
 * educational stage, and §2.2 scopes `display_order` *within* the Category, so
 * the move would also leave the ordering meaningless. Creating the Level in the
 * right Category is the supported path; there is no evidence a move is ever the
 * right answer, and TD-8 would record it as a rename.
 *
 * **`gender_restriction` IS editable**, and that is not the same hazard:
 * Revision 27 makes it the single readable expression of who a Level admits, and
 * enabling Teen + Male was named there as ordinary Super Admin data entry.
 * Tightening it does **not** evict anyone already enrolled — the restriction
 * gates admission (§4.4b), and retroactively removing students from a Level they
 * are studying in is not a decision this endpoint may take silently.
 */
export async function updateLevel(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: {
    name?: string;
    genderRestriction?: 'any' | 'girls_only' | 'boys_only';
    displayOrder?: number | null;
  },
): Promise<Level> {
  assertCanManageReferenceData(actor);

  return updateWithVersion<Level>({
    delegate: prisma.level,
    id,
    expectedVersion,
    requireNotDeleted: true,
    data: { ...data },
  });
}

/**
 * TD-5 soft delete of a Level.
 *
 * **Refused while anything educational still references it** — enrolments,
 * Teaching Groups, Course Schedules, Exams, Library content, its Subject
 * assignments, published Grades or Event scopes. Each of those is either a
 * person's record or a commitment made to one.
 *
 * **Its Administrative Groups are removed WITH it, not counted against it.**
 * This is the exact inverse of TD-4.6b: a Level is created together with
 * المجموعة 1 because a Level with no group is a Level nobody can be admitted to,
 * so every Level always has at least one — and a guard that counted groups would
 * make deletion unreachable by construction. The groups are safe to take because
 * the guards above have already established that none of them holds an
 * enrolment, a schedule or a grade; what remains is the empty scaffolding the
 * Level's own creation put there.
 */
export async function deleteLevel(prisma: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertCanManageReferenceData(actor);

  await prisma.$transaction(async (tx) => {
    // §16.2 sanctioned raw-SQL exception (a): SELECT … FOR UPDATE row lock —
    // check-then-write on an invariant needs the lock, not just the check
    // (TD-15.2), or an enrolment lands between the count and the delete.
    await tx.$queryRaw`SELECT id FROM "level" WHERE id = ${id}::uuid FOR UPDATE`;

    const level = await tx.level.findFirst({ where: { id, deletedAt: null } });
    if (!level) throw new AppError('NOT_FOUND', 'level not found');

    const [enrollments, teachingGroups, schedules, exams, content, subjects, grades, events] =
      await Promise.all([
        tx.enrollment.count({ where: { levelId: id, deletedAt: null } }),
        tx.teachingGroup.count({ where: { levelId: id, deletedAt: null } }),
        tx.recurringCourseSchedule.count({ where: { levelId: id, deletedAt: null } }),
        tx.exam.count({ where: { levelId: id, deletedAt: null } }),
        tx.educationalContent.count({ where: { levelId: id, deletedAt: null } }),
        tx.levelSubject.count({ where: { levelId: id, deletedAt: null } }),
        // Per-group, because a Grade names its Administrative Group rather than
        // the Level. Reached through the group so the guard still describes the
        // Level as a whole. **No `deleted_at` term**: a Grade has no soft-delete
        // column at all — a mark a student was awarded is not a row anyone
        // removes, so every row found here is live by construction.
        tx.grade.count({ where: { administrativeGroup: { levelId: id } } }),
        tx.eventLevel.count({ where: { levelId: id } }),
      ]);
    await assertNoBlockingReferences([
      { label: 'enrollments', count: enrollments },
      { label: 'teaching_groups', count: teachingGroups },
      { label: 'course_schedules', count: schedules },
      { label: 'exams', count: exams },
      { label: 'content', count: content },
      { label: 'subjects', count: subjects },
      { label: 'grades', count: grades },
      { label: 'events', count: events },
    ]);

    const now = new Date();
    const groups = await tx.administrativeGroup.findMany({
      where: { levelId: id, deletedAt: null },
      select: { id: true },
    });
    await tx.administrativeGroup.updateMany({
      where: { levelId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.userId },
    });

    await tx.level.update({ where: { id }, data: { deletedAt: now, deletedById: actor.userId } });
    await trash.snapshot(tx, {
      targetEntity: 'Level',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(level)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'level.delete',
      targetEntity: 'Level',
      targetId: id,
      detail: {
        name: level.name,
        category_id: level.categoryId,
        // Named, not merely counted: these groups disappeared as a CONSEQUENCE
        // of this decision, and TD-8's record has to say which.
        cascaded_group_ids: groups.map((g) => g.id),
      },
    });
  });
}

/**
 * Creates a Level **and** its first Administrative Group, atomically (TD-4.6b).
 *
 * Both rows commit or neither does. A partial commit here is the one outcome
 * this transaction exists to prevent.
 */
export async function createLevel(
  prisma: PrismaClient,
  actor: Actor,
  input: CreateLevelInput,
): Promise<CreatedLevel> {
  assertCanManageReferenceData(actor);

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new AppError('NOT_FOUND', 'no such category');

    // Validated live: a Level created against a soft-deleted branch would give
    // its first group a home nobody can reach. `operational_start_date` is
    // deliberately NOT checked — a branch that has not opened yet is a
    // legitimate place to prepare groups for (§7, the same rule R39 applies to
    // `intended_branch_id`).
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new AppError('NOT_FOUND', 'no such branch');

    const level = await tx.level.create({
      data: {
        name: input.name,
        categoryId: input.categoryId,
        genderRestriction: input.genderRestriction,
        displayOrder: input.displayOrder ?? null,
      },
    });

    const firstGroup = await tx.administrativeGroup.create({
      data: {
        name: FIRST_GROUP_NAME,
        levelId: level.id,
        branchId: input.branchId,
        displayOrder: 0,
      },
      select: { id: true, name: true, branchId: true },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'level.create',
      targetEntity: 'Level',
      targetId: level.id,
      detail: {
        name: level.name,
        category_id: level.categoryId,
        gender_restriction: level.genderRestriction,
        // The group is part of the same decision, so it belongs in the same
        // record — otherwise "where did this group come from" is unanswerable.
        first_group_id: firstGroup.id,
        first_group_branch_id: firstGroup.branchId,
      },
    });

    return { level, firstGroup };
  });
}

/**
 * Levels that have no live Administrative Group.
 *
 * Exists for the TD-4.6d bootstrap backfill and for asserting the invariant in
 * tests. **After bootstrap this must always be empty** — `createLevel` above is
 * the only way a Level enters the system through the application, and it cannot
 * produce one.
 */
export async function levelsWithoutGroups(
  prisma: PrismaClient,
): Promise<{ id: string; name: string }[]> {
  return prisma.level.findMany({
    where: {
      deletedAt: null,
      administrativeGroups: { none: { deletedAt: null } },
    },
    select: { id: true, name: true },
    orderBy: { displayOrder: 'asc' },
  });
}

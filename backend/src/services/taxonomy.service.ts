import type { Category, PrismaClient, Subject } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import { assertNoBlockingReferences, updateWithVersion } from '../repositories/optimistic-lock.js';
import * as trash from '../repositories/trash.repository.js';
import type { Actor } from '../policies/actor.js';

/**
 * Curriculum taxonomy — **Categories and Subjects** (§5.6 *"Categories &
 * Subjects"*, §14.1 الفئات والمواد, §4.4b, TD-2 R26, TD-5, TD-15).
 *
 * These are the two flat vocabularies the whole educational model is built on:
 * a Category groups Levels (§4.4b), and a Subject is what a Level teaches
 * (§4.4c). Everything else — Levels, Administrative Groups, Teaching Groups,
 * Course Schedules — names one or both of them.
 *
 * **Both are reference data: Admin reads, Super Admin writes** (TD-2 R26), the
 * same rule Branches and Rooms follow and for the same reason — an Admin cannot
 * do operational work without seeing the vocabulary, and changing the vocabulary
 * is an organisational decision rather than an operational one.
 *
 * **Categories must never encode sex** (Revision 27). They are generic
 * educational stages — Child, Teen, Adult — and the sex rule lives on
 * `Level.gender_restriction`, where a query can read it. This service cannot
 * enforce a naming convention, but the rule is recorded here because this is
 * where someone would be tempted to create «اليافعات».
 *
 * ## Why Subject lives here rather than in `reference-data.service.ts`
 *
 * That module is the **selector** layer, and `GET /admin/subjects` is still its
 * endpoint — but a concept with its reads in one service and its writes in
 * another is exactly the split that drifts. Subject now has one home; the
 * selector calls into it.
 */

/** TD-2 R26: reading reference data is Admin and above. */
function assertCanRead(actor: Actor): void {
  const permitted =
    scope.isSuperAdmin(actor.roleScopes) || scope.hasRole(actor.roleScopes, 'admin');
  if (!permitted) throw new AppError('FORBIDDEN', 'reading reference data requires admin (TD-2 R26)');
}

/** TD-2 R26: the curriculum vocabulary is Super Admin only. */
function assertCanWrite(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes)) {
    throw new AppError('FORBIDDEN', 'curriculum reference data is Super Admin only (TD-2 R26)');
  }
}

/* ── Subjects ─────────────────────────────────────────────────────────────── */

export interface SubjectRef {
  id: string;
  name: string;
  displayOrder: number | null;
  /**
   * **TD-15, and the reason there is no second Subject list.** A selector does
   * not need a version; the الفئات والمواد screen editing the same rows does.
   * Publishing it on the one list is what let that screen reuse this endpoint
   * instead of growing a parallel `GET` with a wider projection — two reads of
   * one table that would then have to be kept in step.
   */
  version: number;
}

/**
 * A Subject **with the Levels that teach it** (2026-08-17).
 *
 * A separate interface rather than a widened `SubjectRef`, because
 * `listLevelSubjects` returns the narrow shape and has no business computing a
 * reverse join: a Level's own subjects do not need every Level each of them is
 * paired with. One service, two intentional projections — not two reads.
 */
export interface SubjectWithLevels extends SubjectRef {
  /**
   * **The Levels that teach this Subject.**
   *
   * Added so `/admin/subjects` can show the dependency that makes deletion
   * refusable. The rule is unchanged — a Subject paired with any Level cannot be
   * deleted — but an administrator meeting that refusal had **no way to see what
   * it was about**, and the remedy (unpair it on `مواد المستوى`) needs to know
   * *which* Levels.
   *
   * `LevelSubject` is the join, and the Category comes with the Level because
   * §4.4b makes Level names non-unique across Categories — the client's
   * `levelLabel` needs both halves, and shipping a pre-joined string would be a
   * second implementation of that format.
   *
   * **One query, not one per Subject.** The include is part of the same
   * `findMany`, so this is an extra join rather than an N+1.
   */
  levels: { id: string; name: string; categoryName: string }[];
}

/**
 * Every live Subject, ordered as the platform orders reference data.
 *
 * **Not paginated, deliberately.** A selector must offer every option or it is
 * lying about the choice available, and a paged `<select>` is a control with a
 * hidden second page. The set is bounded by the curriculum — tens of rows, not
 * thousands — which is the condition that makes TD-10 the wrong tool here.
 */
export async function listSubjects(
  prisma: PrismaClient,
  actor: Actor,
): Promise<SubjectWithLevels[]> {
  assertCanRead(actor);

  const rows = await prisma.subject.findMany({
    where: { deletedAt: null },
    // BR-19: `display_order` first, then the natively `ar-x-icu` collated name —
    // correct Arabic ordering with no per-query COLLATE (§20 rule 13).
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      displayOrder: true,
      version: true,
      // Live pairings only, and live Levels only: a soft-deleted Level does not
      // block anything, so listing it would name a dependency that is not there.
      levels: {
        where: { deletedAt: null, level: { deletedAt: null } },
        select: {
          level: {
            select: {
              id: true,
              name: true,
              displayOrder: true,
              category: { select: { name: true, displayOrder: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((subject) => ({
    id: subject.id,
    name: subject.name,
    displayOrder: subject.displayOrder,
    version: subject.version,
    levels: subject.levels
      // Category then Level, the reading order of the hierarchy — and the
      // Category first because `Level.displayOrder` is scoped WITHIN its Category
      // (§2.2), so ordering by it across Categories interleaves them.
      .map((pair) => pair.level)
      .sort(
        (a, b) =>
          (a.category.displayOrder ?? 0) - (b.category.displayOrder ?? 0) ||
          a.category.name.localeCompare(b.category.name, 'ar') ||
          (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
          a.name.localeCompare(b.name, 'ar'),
      )
      .map((level) => ({ id: level.id, name: level.name, categoryName: level.category.name })),
  }));
}

export async function createSubject(
  prisma: PrismaClient,
  actor: Actor,
  data: { name: string; displayOrder?: number | null },
): Promise<Subject> {
  assertCanWrite(actor);

  return prisma.$transaction(async (tx) => {
    const subject = await tx.subject.create({
      data: { name: data.name, displayOrder: data.displayOrder ?? null },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'subject.create',
      targetEntity: 'Subject',
      targetId: subject.id,
      detail: { name: subject.name },
    });
    return subject;
  });
}

export async function updateSubject(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: { name?: string; displayOrder?: number | null },
): Promise<Subject> {
  assertCanWrite(actor);
  return updateWithVersion<Subject>({
    delegate: prisma.subject,
    id,
    expectedVersion,
    requireNotDeleted: true,
    data: { ...data },
  });
}

/**
 * TD-5 soft delete, **refused while anything still teaches the Subject**.
 *
 * The blockers are every place a Subject is named as the thing being taught: its
 * Level assignments (§4.4b), the Teaching Groups that split it (§4.4c), the
 * Course Schedules that deliver it (§4.4), and the Exams and Library content
 * filed under it. Removing it beneath any of those would leave rows pointing at
 * a subject the curriculum no longer contains — and the FKs are `Restrict`, so
 * the alternative to this check is a constraint violation surfacing as a 500.
 *
 * **The Level assignment is a blocker, not a cascade.** It is cheap to undo from
 * the Subject Organisation screen, and undoing it deliberately is how an
 * administrator finds out which Levels were still teaching this.
 */
export async function deleteSubject(prisma: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertCanWrite(actor);

  await prisma.$transaction(async (tx) => {
    // §16.2 sanctioned raw-SQL exception (a): SELECT … FOR UPDATE row lock, so
    // the count and the delete cannot straddle a concurrent assignment
    // (TD-15.2 — check-then-write needs the lock, not just the check).
    await tx.$queryRaw`SELECT id FROM "subject" WHERE id = ${id}::uuid FOR UPDATE`;

    const subject = await tx.subject.findFirst({ where: { id, deletedAt: null } });
    if (!subject) throw new AppError('NOT_FOUND', 'subject not found');

    const [levels, teachingGroups, schedules, exams, content] = await Promise.all([
      tx.levelSubject.count({ where: { subjectId: id, deletedAt: null } }),
      tx.teachingGroup.count({ where: { subjectId: id, deletedAt: null } }),
      tx.recurringCourseSchedule.count({ where: { subjectId: id, deletedAt: null } }),
      tx.exam.count({ where: { subjectId: id, deletedAt: null } }),
      tx.educationalContent.count({ where: { subjectId: id, deletedAt: null } }),
    ]);
    await assertNoBlockingReferences([
      { label: 'levels', count: levels },
      { label: 'teaching_groups', count: teachingGroups },
      { label: 'course_schedules', count: schedules },
      { label: 'exams', count: exams },
      { label: 'content', count: content },
    ]);

    await tx.subject.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actor.userId } });
    await trash.snapshot(tx, {
      targetEntity: 'Subject',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(subject)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'subject.delete',
      targetEntity: 'Subject',
      targetId: id,
      detail: { name: subject.name },
    });
  });
}

/* ── Categories ───────────────────────────────────────────────────────────── */

export interface CategoryRef {
  id: string;
  name: string;
  displayOrder: number | null;
  /** How many live Levels sit in it — the one number that says whether deleting
   *  it is even possible, without a request per row. */
  levelCount: number;
  version: number;
}

/**
 * Every live Category.
 *
 * **Not the same read as `/calendar/bootstrap`**, which also returns categories:
 * that contract is the *public calendar screen's* reference data, cached, with
 * no `version` and no counts. Widening it to serve an editor would let an
 * unrelated screen shape a public, cached payload — the reasoning already
 * recorded for `GET /admin/subjects`.
 */
export async function listCategories(prisma: PrismaClient, actor: Actor): Promise<CategoryRef[]> {
  assertCanRead(actor);

  const rows = await prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      displayOrder: true,
      version: true,
      _count: { select: { levels: { where: { deletedAt: null } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    displayOrder: row.displayOrder,
    levelCount: row._count.levels,
    version: row.version,
  }));
}

/** A freshly created Category has no Levels — stated, not counted. */
export async function createCategory(
  prisma: PrismaClient,
  actor: Actor,
  data: { name: string; displayOrder?: number | null },
): Promise<CategoryRef> {
  assertCanWrite(actor);

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.create({
      data: { name: data.name, displayOrder: data.displayOrder ?? null },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'category.create',
      targetEntity: 'Category',
      targetId: category.id,
      detail: { name: category.name },
    });
    return {
      id: category.id,
      name: category.name,
      displayOrder: category.displayOrder,
      levelCount: 0,
      version: category.version,
    };
  });
}

export async function updateCategory(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  expectedVersion: number,
  data: { name?: string; displayOrder?: number | null },
): Promise<CategoryRef> {
  assertCanWrite(actor);
  const category = await updateWithVersion<Category>({
    delegate: prisma.category,
    id,
    expectedVersion,
    requireNotDeleted: true,
    data: { ...data },
  });
  const levelCount = await prisma.level.count({ where: { categoryId: id, deletedAt: null } });
  return {
    id: category.id,
    name: category.name,
    displayOrder: category.displayOrder,
    levelCount,
    version: category.version,
  };
}

/**
 * TD-5 soft delete, **refused while Levels, Event scopes or PENDING
 * registration requests reference it**.
 *
 * A Category is deliberately *not* allowed to take its Levels with it: a Level
 * carries enrolments, groups and schedules, so cascading here would delete a
 * live curriculum from a screen whose control says "delete category".
 *
 * **The soft delete is what keeps decided requests valid.** A person who asked
 * for a stage the association later retired still has a readable record,
 * because the row is still there to join to — which is why only *pending*
 * requests block, and history never does.
 */
export async function deleteCategory(prisma: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertCanWrite(actor);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "category" WHERE id = ${id}::uuid FOR UPDATE`;

    const category = await tx.category.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new AppError('NOT_FOUND', 'category not found');

    const [levels, events, pendingRequests] = await Promise.all([
      tx.level.count({ where: { categoryId: id, deletedAt: null } }),
      tx.eventCategory.count({ where: { categoryId: id } }),
      // Revision 49 (Document Owner decision, 2026-08-05): **a Category with
      // PENDING registration requests pointing at it must not vanish
      // underneath them** — the §4.1 approval screen would be left preselecting
      // Levels from a stage that no longer exists, and the applicant's stated
      // choice would silently become unreadable.
      //
      // **Only pending ones block.** Once a request is decided, its
      // `intended_category_id` is history — what the person asked for — and the
      // soft delete keeps that row perfectly readable, since a soft-deleted
      // Category is still there to join to. Blocking on decided requests would
      // mean a Category could never be retired at all.
      tx.user.count({
        where: { intendedCategoryId: id, accountStatus: 'pending', deletedAt: null },
      }),
    ]);
    await assertNoBlockingReferences([
      { label: 'levels', count: levels },
      { label: 'events', count: events },
      { label: 'pending_requests', count: pendingRequests },
    ]);

    await tx.category.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'Category',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(category)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'category.delete',
      targetEntity: 'Category',
      targetId: id,
      detail: { name: category.name },
    });
  });
}

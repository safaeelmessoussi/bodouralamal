import type { Prisma, PrismaClient, TeachingGroup } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import { assertSubjectTaughtAtLevel } from '../policies/curriculum.js';
import * as scope from '../policies/branch-scope.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { updateWithVersion } from '../repositories/optimistic-lock.js';
import { enqueueConsentReevaluationForStudent } from './enrollment.service.js';
import type { Actor } from '../policies/actor.js';

/**
 * Teaching Groups — a **subject-specific split** inside a Level (SRS §4.4c,
 * BR-22, Revision 43).
 *
 * A Teaching Group belongs to a **Subject and a Level, never to an
 * Administrative Group**, and exists **only** where a Subject needs students
 * divided differently from the administrative roster. A Subject with no rows
 * here is taught to the entire Level — creating these is not a prerequisite for
 * teaching anything.
 *
 * **The splits are independent between Subjects.** One student sits in
 * Administrative Group 1, Quran Group 2 and Tajweed Group 1 at once. That falls
 * out of the uniqueness being **per (student, subject, level)** rather than per
 * student — it is not enforced by anything in this file, and must not be.
 *
 * ---
 *
 * **Authority is SPLIT, and the reason is structural (Revision 43.3).**
 *
 * A Teaching Group carries no branch — it belongs to a Subject and a Level, and
 * a Level spans branches (§4.4b). So *"within your branch scope"* has **no
 * referent** for the group itself, and the scope check every other operational
 * service performs cannot be written.
 *
 * | Action | Who | Why |
 * |---|---|---|
 * | Create / rename / reorder / delete a group | **Super Admin only** | Curriculum *structure*, alongside the Levels and Subjects it organises (Revision 26) |
 * | Place a student into a group | **Admin**, scoped by the branch the student is **enrolled at** | Placement is operational, and `Enrollment → AdministrativeGroup.branch_id` is a referent that exists |
 *
 * Without the split a Marrakesh Admin could delete the Quran split that Targa's
 * students depend on, while the unassigned list showed them only Marrakesh
 * students — authority over everyone, visibility of some.
 */

const MANAGING_ROLE = 'admin';

const isSuperAdmin = (actor: Actor): boolean => scope.isSuperAdmin(actor.roleScopes);

/** Revision 43.3: group CRUD is reference-data management. */
function assertCanManageGroups(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw new AppError('FORBIDDEN', 'teaching group management is Super Admin only (R43.3)');
  }
}

/** Revision 43.3: membership is operational — Admin or Super Admin. */
function assertCanManageMembership(actor: Actor): void {
  if (!(scope.hasRole(actor.roleScopes, MANAGING_ROLE) || isSuperAdmin(actor))) {
    throw new AppError('FORBIDDEN', 'teaching group membership requires admin');
  }
}

/**
 * The branch a student is actually at, for the (Subject, Level) being organised.
 *
 * **This is the referent that makes membership scopeable** where the group
 * itself is not. A student with no live enrolment in that Level is not placeable
 * into its splits at all — which is BR-22 read from the other direction: an
 * unplaced student must be *enrolled* before they can be placed.
 */
async function studentBranchInLevel(
  tx: Prisma.TransactionClient,
  studentId: string,
  levelId: string,
): Promise<string> {
  const enrolment = await tx.enrollment.findFirst({
    where: {
      studentId,
      levelId,
      deletedAt: null,
      // **R66, completed.** The `select` below was updated for R66 and this
      // `where` was not: a relation filter does not match a NULL relation, so a
      // student enrolled directly in an unsubdivided Level looked *not enrolled*
      // and could not be placed in any circle at all. The predicate is
      // `levelsForStudent`'s, which already says it correctly — the enrolment is
      // live, and IF it has a group that group is live too.
      OR: [{ administrativeGroupId: null }, { administrativeGroup: { deletedAt: null } }],
    },
    // R66 — R43.3 scoped this by `Enrollment → AdministrativeGroup.branch_id`,
    // calling it "a referent that does exist". It is now the enrolment's own
    // column, which exists for an ungrouped student too.
    select: { branchId: true },
  });
  if (!enrolment) {
    throw new AppError('STATE_CONFLICT', 'student is not enrolled in this level', {
      reason: 'NOT_ENROLLED_IN_LEVEL',
      level_id: levelId,
    });
  }
  return enrolment.branchId;
}

export async function listTeachingGroups(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
  subjectId: string,
): Promise<(TeachingGroup & { memberCount: number })[]> {
  assertCanManageMembership(actor);

  const rows = await prisma.teachingGroup.findMany({
    where: { levelId, subjectId, deletedAt: null },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { members: { where: { deletedAt: null } } } } },
  });
  return rows.map(({ _count, ...g }) => ({ ...g, memberCount: _count.members }));
}

/**
 * **Every circle the caller may see, across Levels and Subjects.**
 *
 * ## Why a second read, when `listTeachingGroups` exists
 *
 * `listTeachingGroups` is addressed by `(Level, Subject)` because that pair is
 * what a split *is* — and that is exactly why it cannot answer *"what circles
 * exist"*. A screen wanting one table had to ask **Levels × Subjects** times,
 * which is why `حلقات المواد` was built as an accordion that loads a Level at a
 * time: the shape of the read decided the shape of the screen.
 *
 * This is the **same rows, the same gate, a wider filter**. It grants nothing
 * new: `assertCanManageMembership` is the identical check the nested read
 * performs, and every parameter here narrows rather than widens.
 *
 * ## A circle has no branch, and this read does not invent one
 *
 * R43.3's structural point — *"a Teaching Group carries no branch … so 'within
 * your branch scope' has no referent"* — is why there is **no `branchId`
 * filter and no branch column**. A branch reaches a circle only through the
 * enrolments of its members, and offering *"circles at Marrakesh"* would mean
 * *"circles at least one of whose members is enrolled at Marrakesh"* — a
 * different question, silently answered. §20 rule 22 forbids conflating the
 * organisational unit with its delivery, and a branch on a circle is that
 * conflation.
 *
 * For the same reason there is **no مؤطرة column**: staffing lives on
 * `CourseSchedule` (§4.4c), which is what resolves *who teaches* — a circle is
 * an audience, not a class.
 *
 * ## `q` matches the circle, its Level and its Subject
 *
 * Because those are the three things visible in the row, and a filter that
 * matches less than the reader can see reads as a broken filter.
 */
export interface TeachingGroupRow {
  id: string;
  name: string;
  displayOrder: number | null;
  levelId: string;
  levelName: string;
  categoryName: string;
  subjectId: string;
  subjectName: string;
  memberCount: number;
  version: number;
}

export async function listAllTeachingGroups(
  prisma: PrismaClient,
  actor: Actor,
  filters: {
    levelId?: string;
    subjectId?: string;
    categoryId?: string;
    q?: string;
  } & PageParams,
): Promise<Page<TeachingGroupRow>> {
  assertCanManageMembership(actor);

  // TD-10's single implementation, not a `skip`/`take` of this file's own.
  const window = pageWindow(filters);

  const q = filters.q?.trim() ?? '';
  const where: Prisma.TeachingGroupWhereInput = {
    deletedAt: null,
    ...(filters.levelId ? { levelId: filters.levelId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.categoryId ? { level: { categoryId: filters.categoryId } } : {}),
    ...(q === ''
      ? {}
      : {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { level: { name: { contains: q, mode: 'insensitive' } } },
            { subject: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }),
  };

  // One query for the page and one for the count — never a count derived from
  // the page, which would report the page size as the total.
  const [rows, total] = await Promise.all([
    prisma.teachingGroup.findMany({
      where,
      // Category, then Level, then Subject, then the circle's own order: the
      // reading order of the hierarchy the rows belong to, so a table sorts the
      // way the menu does. **The Category comes first because
      // `Level.displayOrder` is scoped WITHIN its Category** (§2.2) — ordering
      // by it across Categories interleaves them, and a table where اليافعات 1
      // sits between المرأة 1 and المرأة 2 is a table nobody can read.
      orderBy: [
        { level: { category: { displayOrder: 'asc' } } },
        { level: { category: { name: 'asc' } } },
        { level: { displayOrder: 'asc' } },
        { level: { name: 'asc' } },
        { subject: { name: 'asc' } },
        { displayOrder: 'asc' },
        { name: 'asc' },
      ],
      skip: window.skip,
      take: window.take,
      include: {
        level: { select: { id: true, name: true, category: { select: { name: true } } } },
        subject: { select: { id: true, name: true } },
        _count: { select: { members: { where: { deletedAt: null } } } },
      },
    }),
    prisma.teachingGroup.count({ where }),
  ]);

  return page(
    rows.map((g) => ({
      id: g.id,
      name: g.name,
      displayOrder: g.displayOrder,
      levelId: g.level.id,
      levelName: g.level.name,
      categoryName: g.level.category.name,
      subjectId: g.subject.id,
      subjectName: g.subject.name,
      memberCount: g._count.members,
      version: g.version,
    })),
    window,
    total,
  );
}

export async function createTeachingGroup(
  prisma: PrismaClient,
  actor: Actor,
  input: { levelId: string; subjectId: string; name: string; displayOrder?: number | null },
): Promise<TeachingGroup> {
  assertCanManageGroups(actor);

  return prisma.$transaction(async (tx) => {
    const level = await tx.level.findFirst({
      where: { id: input.levelId, deletedAt: null },
      select: { id: true },
    });
    if (!level) throw new AppError('NOT_FOUND', 'no such level');

    const subject = await tx.subject.findFirst({
      where: { id: input.subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) throw new AppError('NOT_FOUND', 'no such subject');

    // The Subject must actually be taught at this Level. Splitting a Subject a
    // Level does not offer would create groups nothing can ever schedule, and
    // they would sit in the taxonomy looking legitimate. **The rule lives in
    // `policies/curriculum.ts`** — it governs scheduling and content too, and
    // this was one of the three copies that had already diverged.
    await assertSubjectTaughtAtLevel(tx, input.levelId, input.subjectId);

    const group = await tx.teachingGroup.create({
      data: {
        name: input.name,
        levelId: input.levelId,
        subjectId: input.subjectId,
        displayOrder: input.displayOrder ?? null,
      },
    });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'teachinggroup.create',
      targetEntity: 'TeachingGroup',
      targetId: group.id,
      detail: { name: group.name, level_id: group.levelId, subject_id: group.subjectId },
    });
    return group;
  });
}

export async function updateTeachingGroup(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  data: { name?: string; displayOrder?: number | null; version: number },
): Promise<TeachingGroup> {
  assertCanManageGroups(actor);

  const existing = await prisma.teachingGroup.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such teaching group');

  // Subject and Level are not editable: either would break the composite FK
  // that keeps every member row's (subject, level) honest, and would silently
  // re-file a whole cohort under a different curriculum item.
  return prisma.$transaction(async (tx) => {
    const updated = await updateWithVersion<TeachingGroup>({
      delegate: tx.teachingGroup,
      id,
      expectedVersion: data.version,
      requireNotDeleted: true,
      data: {
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.displayOrder === undefined ? {} : { displayOrder: data.displayOrder }),
      },
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'teachinggroup.update',
      targetEntity: 'TeachingGroup',
      targetId: id,
      detail: { name: updated.name },
    });
    return updated;
  });
}

/**
 * Soft-deletes a teaching group (TD-5).
 *
 * **Prohibited while a Course Schedule targets it.** Its member rows are removed
 * with it, and **the affected students return to that Subject's `unassigned`
 * list** (BR-22) rather than vanishing from it — which is the whole point of
 * that list existing.
 */
export async function deleteTeachingGroup(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
): Promise<{ releasedStudents: number }> {
  assertCanManageGroups(actor);

  const group = await prisma.teachingGroup.findFirst({ where: { id, deletedAt: null } });
  if (!group) throw new AppError('NOT_FOUND', 'no such teaching group');

  return prisma.$transaction(async (tx) => {
    const scheduled = await tx.recurringCourseSchedule.count({
      where: { teachingGroupId: id, deletedAt: null },
    });
    if (scheduled > 0) {
      throw new AppError('STATE_CONFLICT', 'teaching group is targeted by a course schedule', {
        reason: 'SCHEDULES_EXIST',
        schedules: scheduled,
      });
    }

    const members = await tx.studentTeachingGroup.findMany({
      where: { teachingGroupId: id, deletedAt: null },
      select: { studentId: true },
    });

    // Enqueued while the members are still in the audience — afterwards the
    // group is gone and a derived lookup would skip the very sessions whose
    // gate just changed.
    for (const m of members) {
      await enqueueConsentReevaluationForStudent(tx, m.studentId);
    }

    const now = new Date();
    await tx.studentTeachingGroup.updateMany({
      where: { teachingGroupId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    await tx.teachingGroup.update({
      where: { id },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'TeachingGroup',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(group)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'teachinggroup.delete',
      targetEntity: 'TeachingGroup',
      targetId: id,
      detail: {
        name: group.name,
        level_id: group.levelId,
        subject_id: group.subjectId,
        // The number that answers "how many students went back to unassigned",
        // which is unanswerable later once the list has been worked through.
        released_students: members.length,
      },
    });
    return { releasedStudents: members.length };
  });
}

/**
 * Places a student into a Teaching Group.
 *
 * **At most one per (student, Subject, Level)** — enforced by a partial unique
 * index over columns on the row (Revision 43.2). A student already in a
 * different split of the same Subject is a `STATE_CONFLICT` naming that split,
 * because the intended action was almost certainly a move.
 */
export async function addMember(
  prisma: PrismaClient,
  actor: Actor,
  teachingGroupId: string,
  studentId: string,
): Promise<{ id: string }> {
  assertCanManageMembership(actor);

  return prisma.$transaction(async (tx) => {
    const group = await tx.teachingGroup.findFirst({
      where: { id: teachingGroupId, deletedAt: null },
      // `name` is read for the Trash label (R59.2), not for the membership rule.
      select: { id: true, levelId: true, subjectId: true },
    });
    if (!group) throw new AppError('NOT_FOUND', 'no such teaching group');

    const student = await tx.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppError('NOT_FOUND', 'no such student');

    // Revision 43.3: the scope referent is the branch the student is enrolled
    // at, not the group's (it has none).
    const branchId = await studentBranchInLevel(tx, studentId, group.levelId);
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId, 'no such student');

    const existing = await tx.studentTeachingGroup.findFirst({
      where: {
        studentId,
        subjectId: group.subjectId,
        levelId: group.levelId,
        deletedAt: null,
      },
      select: { id: true, teachingGroupId: true },
    });
    if (existing) {
      if (existing.teachingGroupId === teachingGroupId) {
        throw new AppError('DUPLICATE', 'student is already in this teaching group');
      }
      throw new AppError('STATE_CONFLICT', 'student is already in another split of this subject', {
        reason: 'ALREADY_IN_SUBJECT_SPLIT',
        subject_id: group.subjectId,
        level_id: group.levelId,
        current_teaching_group_id: existing.teachingGroupId,
      });
    }

    const row = await tx.studentTeachingGroup.create({
      data: {
        studentId,
        teachingGroupId,
        // From the group, never the caller — the composite FK is the backstop,
        // not the primary defence (Revision 43.2).
        subjectId: group.subjectId,
        levelId: group.levelId,
      },
      select: { id: true },
    });

    await enqueueConsentReevaluationForStudent(tx, studentId);

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'teachinggroup.member_add',
      targetEntity: 'StudentTeachingGroup',
      targetId: row.id,
      detail: {
        student_id: studentId,
        teaching_group_id: teachingGroupId,
        subject_id: group.subjectId,
        level_id: group.levelId,
        branch_id: branchId,
      },
    });
    return row;
  });
}

/** Removes a student from a split. They return to the Subject's `unassigned`
 *  list (BR-22) — never silently classless. */
/**
 * **Who is in one circle.**
 *
 * ## Why this read was missing, and why it is not a new capability
 *
 * `POST /admin/teaching-groups/{id}/members` and
 * `DELETE …/members/{studentId}` have both existed since R43 (TD-3.12), so the
 * collection is specified — **it simply had no `GET`**. The consequence showed up
 * in the interface: `readSubjectSplit` reports a `member_count` per circle and
 * BR-22's *unassigned* list, so a screen could say *how many* are in a circle and
 * *who is in none*, but never *who is in this one* — which is exactly what is
 * needed to take somebody out of it. The `DELETE` route had no frontend caller at
 * all for that reason.
 *
 * This completes the collection rather than opening a new one: same path, same
 * `assertCanManageMembership` gate, same branch scoping through the student's
 * enrolment.
 *
 * ## Not paginated
 *
 * A circle is a subdivision of one Level's enrolment — tens of students, and the
 * screen's whole question is *the roster*. TD-10's page boundary through a roster
 * would hide members behind a control nobody needs, which is the same argument
 * the pair-addressed split read makes for its own list.
 */
export interface CircleMember {
  studentId: string;
  name: string | null;
  addedAt: Date;
}

export async function listMembers(
  prisma: PrismaClient,
  actor: Actor,
  teachingGroupId: string,
): Promise<CircleMember[]> {
  assertCanManageMembership(actor);

  const group = await prisma.teachingGroup.findFirst({
    where: { id: teachingGroupId, deletedAt: null },
    select: { id: true },
  });
  // §20 rule 17 — a circle out of reach is NOT_FOUND, never a 403 confirming it
  // exists somewhere.
  if (!group) throw new AppError('NOT_FOUND', 'no such teaching group');

  const rows = await prisma.studentTeachingGroup.findMany({
    where: { teachingGroupId, deletedAt: null, student: { deletedAt: null } },
    orderBy: { student: { nameArabic: 'asc' } },
    select: { studentId: true, addedAt: true, student: { select: { nameArabic: true } } },
  });

  return rows.map((row) => ({
    studentId: row.studentId,
    // The staff-facing legal name, as on every other roster: §7's public
    // display-identity rule governs public surfaces, and this is not one.
    name: row.student.nameArabic,
    addedAt: row.addedAt,
  }));
}

export async function removeMember(
  prisma: PrismaClient,
  actor: Actor,
  teachingGroupId: string,
  studentId: string,
): Promise<void> {
  assertCanManageMembership(actor);

  await prisma.$transaction(async (tx) => {
    const group = await tx.teachingGroup.findFirst({
      where: { id: teachingGroupId, deletedAt: null },
      // `name` is read for the Trash label (R59.2), not for the membership rule.
      select: { id: true, levelId: true, subjectId: true, name: true },
    });
    if (!group) throw new AppError('NOT_FOUND', 'no such teaching group');

    const branchId = await studentBranchInLevel(tx, studentId, group.levelId);
    scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId, 'no such student');

    const row = await tx.studentTeachingGroup.findFirst({
      where: { teachingGroupId, studentId, deletedAt: null },
    });
    if (!row) throw new AppError('NOT_FOUND', 'student is not in this teaching group');

    await enqueueConsentReevaluationForStudent(tx, studentId);

    await tx.studentTeachingGroup.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    // R59.2 — a deliberate removal by an Admin, and one of the six relationship
    // types §7's runbook must reinstate. It was audited and absent from the
    // Trash, which is where a restoration would go looking for it.
    await trash.snapshot(tx, {
      targetEntity: 'StudentTeachingGroup',
      targetId: row.id,
      snapshot: JSON.parse(
        JSON.stringify({
          ...row,
          // A join row has no name of its own — composed, or the entry is a UUID.
          label: `${(await tx.user.findUnique({ where: { id: studentId }, select: { nameArabic: true } }))?.nameArabic ?? '—'} — ${group.name}`,
        }),
      ) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'teachinggroup.member_remove',
      targetEntity: 'StudentTeachingGroup',
      targetId: row.id,
      detail: {
        student_id: studentId,
        teaching_group_id: teachingGroupId,
        subject_id: group.subjectId,
        level_id: group.levelId,
      },
    });
  });
}

export interface UnassignedStudent {
  studentId: string;
  nameArabic: string | null;
  administrativeGroupId: string | null;
  branchId: string;
}

/**
 * **The unassigned list (BR-22, §5.6) — required, not cosmetic.**
 *
 * Students enrolled in a Level whose Subject **is** split, but who hold no
 * Teaching Group for it. Such a student has **no sessions for that Subject**,
 * and without this list nothing in the platform would say so. That is the whole
 * justification: a silent gap here is a beneficiary quietly receiving no
 * teaching in a subject.
 *
 * **The list is EMPTY when the Subject is not split, and that is not the same
 * as "everyone is assigned".** A Subject with no Teaching Groups is taught to
 * the entire Level (§4.4c), so nobody is unassigned — asking the question is a
 * category error, and returning every enrolled student would read as an alarm.
 * The `split` flag is returned so a caller cannot confuse the two.
 *
 * **Branch-scoped for an Admin**, unscoped for a Super Admin. A branch Admin
 * therefore sees a *partial* list — their own students — which is correct under
 * Revision 43.3: they may place only the students they are responsible for.
 */
export async function listUnassignedStudents(
  prisma: PrismaClient,
  actor: Actor,
  levelId: string,
  subjectId: string,
): Promise<{ split: boolean; unassigned: UnassignedStudent[] }> {
  assertCanManageMembership(actor);

  const splitCount = await prisma.teachingGroup.count({
    where: { levelId, subjectId, deletedAt: null },
  });
  if (splitCount === 0) return { split: false, unassigned: [] };

  const branches = scope.branchesForRole(actor.roleScopes, MANAGING_ROLE);

  const rows = await prisma.enrollment.findMany({
    where: {
      levelId,
      deletedAt: null,
      // **R66 — the enrolment is the primary fact and the group is optional.**
      // This required a live group, so a student enrolled directly in an
      // unsubdivided Level never appeared as a candidate: the server accepted
      // her into a circle while the screen could not offer her.
      OR: [{ administrativeGroupId: null }, { administrativeGroup: { deletedAt: null } }],
      // **Branch-scoped from the ENROLMENT, not through the group** (R66, R43.3
      // as amended): the group was the referent while every enrolment had one,
      // and an ungrouped student has no group to be scoped through.
      // `null` means all-branches (§7, Revision 24), NOT "no branches".
      ...(branches === null ? {} : { branchId: { in: branches } }),
      student: {
        deletedAt: null,
        // The definition of unassigned: no live seat for THIS subject in THIS
        // level. Expressed against the seat's own denormalized columns, which
        // the composite FK keeps honest — so this cannot silently disagree with
        // the group the seat actually points at.
        teachingGroupSeats: { none: { subjectId, levelId, deletedAt: null } },
      },
    },
    select: {
      studentId: true,
      administrativeGroupId: true,
      student: { select: { nameArabic: true } },
      branchId: true,
    },
    orderBy: { student: { nameArabic: 'asc' } },
  });

  return {
    split: true,
    unassigned: rows.map((r) => ({
      studentId: r.studentId,
      nameArabic: r.student.nameArabic,
      administrativeGroupId: r.administrativeGroupId,
      branchId: r.branchId,
    })),
  };
}

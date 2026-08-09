import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { page, pageWindow, type Page, type PageParams } from '../lib/pagination.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { assertSubjectTaughtAtLevel } from '../policies/curriculum.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';

/**
 * Exams as **scheduled sittings** (§4.6 as amended by SRS Revision 58).
 *
 * ## What R58 changed, and what it did not
 *
 * §4.6 said *"digital exams only in MVP … paper sittings are prepared outside
 * the platform"*, and that exams are *"created independently of strict calendar
 * bounds"*. The first is **superseded**: a sitting is organised here now — a
 * branch, a room, a date, a clock window and staff. The second is **narrowed,
 * not deleted**: an exam still needs no Course Schedule and no term boundary to
 * exist. What stays outside the platform is the **paper** — its questions, its
 * print layout, and the marking of scripts.
 *
 * ## The mode is a discriminator, not a flag
 *
 * `physical` carries a place and staff and no questions; `online` will carry
 * questions and no place. Each mode's columns are exactly the ones its own
 * reality has, and the database enforces it, so the mode cannot become a label a
 * caller contradicts.
 *
 * **`online` is refused here, loudly.** The interface offers it disabled (§14.4
 * — a blocked capability states its reason), and this service answers a coded
 * refusal rather than writing a row nothing can yet serve.
 *
 * ## Why this is not a CourseSchedule
 *
 * An exam produces **no Sessions**. It is one dated occurrence, not a rule that
 * generates them, so it takes no part in materialization, the R50 split, or
 * conflict detection against sessions. Reusing `RecurringCourseSchedule` would
 * make a one-off sitting pretend to be a recurrence — the conflation §20 rule 22
 * exists to prevent.
 */

const MANAGING_ROLE = 'admin';

function assertCanManage(actor: Actor): void {
  if (!scope.isSuperAdmin(actor.roleScopes) && !scope.hasRole(actor.roleScopes, MANAGING_ROLE)) {
    throw new AppError('FORBIDDEN', 'scheduling an exam requires admin (TD-2)');
  }
}

export interface ExamStaffInput {
  userId: string;
  position: 'supervisor' | 'assistant';
}

export interface PhysicalExamInput {
  title: string;
  description?: string | null;
  date: Date;
  startTime: Date;
  endTime: Date;
  levelId: string;
  subjectId: string;
  academicYearId: string;
  branchId: string;
  roomId: string;
  /** `null` is **the whole Level** (R58), never "no target". */
  administrativeGroupId?: string | null;
  staff?: ExamStaffInput[];
}

/**
 * Everything the sitting refers to exists and belongs together.
 *
 * **The Level/Subject pairing goes through the shared policy**
 * (`policies/curriculum.ts`) — the same assertion scheduling, teaching-group
 * splits and content all use. R55 exists precisely because that one rule was
 * enforced on two surfaces out of three, under two different names.
 */
async function assertCoherent(
  tx: Prisma.TransactionClient,
  input: Pick<
    PhysicalExamInput,
    'levelId' | 'subjectId' | 'academicYearId' | 'branchId' | 'roomId' | 'administrativeGroupId'
  >,
): Promise<void> {
  await assertSubjectTaughtAtLevel(tx, input.levelId, input.subjectId);

  const [year, room] = await Promise.all([
    tx.academicYear.findFirst({ where: { id: input.academicYearId }, select: { id: true } }),
    tx.room.findFirst({ where: { id: input.roomId, deletedAt: null }, select: { branchId: true } }),
  ]);
  if (!year) throw new AppError('NOT_FOUND', 'no such academic year');
  if (!room) throw new AppError('NOT_FOUND', 'no such room');

  // A room belongs to a branch (§7); a sitting booked into a room at another
  // branch is one the students cannot reach — the rule §4.4 already applies to
  // a course schedule's target.
  if (room.branchId !== input.branchId) {
    // `ROOM_BRANCH_MISMATCH`, the name `session.service.ts` already uses for
    // this exact refusal — NOT a third spelling. `BRANCH_MISMATCH` is taken and
    // means the *audience* is elsewhere; two rules under one code is how a
    // client ends up showing the wrong remedy.
    throw new AppError('VALIDATION_FAILED', 'room is at a different branch', {
      reason: 'ROOM_BRANCH_MISMATCH',
      room_branch_id: room.branchId,
      exam_branch_id: input.branchId,
    });
  }

  if (input.administrativeGroupId) {
    const group = await tx.administrativeGroup.findFirst({
      where: { id: input.administrativeGroupId, deletedAt: null },
      select: { levelId: true, branchId: true },
    });
    if (!group) throw new AppError('NOT_FOUND', 'no such administrative group');
    // The narrower target must be a roster OF this Level AT this branch, or the
    // exam would be sat by people it was not written for.
    // Same rule and same code as a course schedule's target (§4.4): the
    // audience must be at the branch the thing happens at.
    if (group.branchId !== input.branchId) {
      throw new AppError('VALIDATION_FAILED', 'group is at a different branch', {
        reason: 'BRANCH_MISMATCH',
        target_branch_id: group.branchId,
        exam_branch_id: input.branchId,
      });
    }
    // Distinct from the above: the roster exists at the right branch but sits a
    // different Level, so it was not written for this paper.
    if (group.levelId !== input.levelId) {
      throw new AppError('VALIDATION_FAILED', 'that group does not sit this level', {
        reason: 'GROUP_LEVEL_MISMATCH',
        group_level_id: group.levelId,
        exam_level_id: input.levelId,
      });
    }
  }
}

export async function createPhysicalExam(
  prisma: PrismaClient,
  actor: Actor,
  input: PhysicalExamInput,
): Promise<{ id: string }> {
  assertCanManage(actor);
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, input.branchId, 'no such branch');

  return prisma.$transaction(async (tx) => {
    await assertCoherent(tx, input);

    const exam = await tx.exam.create({
      data: {
        mode: 'physical',
        title: input.title,
        description: input.description ?? null,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        levelId: input.levelId,
        subjectId: input.subjectId,
        academicYearId: input.academicYearId,
        branchId: input.branchId,
        roomId: input.roomId,
        administrativeGroupId: input.administrativeGroupId ?? null,
        // §4.6's question array belongs to the ONLINE mode. A physical sitting's
        // paper is not in the platform, so this stays empty rather than holding
        // a placeholder that would read as an exam somebody forgot to write.
        questions: [],
      },
      select: { id: true },
    });

    for (const person of input.staff ?? []) {
      await tx.examStaff.create({
        data: { examId: exam.id, userId: person.userId, position: person.position },
      });
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'exam.create',
      targetEntity: 'Exam',
      targetId: exam.id,
      detail: { mode: 'physical', branch_id: input.branchId, date: input.date.toISOString() },
    });

    return { id: exam.id };
  });
}

export async function updatePhysicalExam(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  input: Partial<PhysicalExamInput> & { version: number },
): Promise<void> {
  assertCanManage(actor);

  const existing = await prisma.exam.findFirst({
    where: { id, deletedAt: null },
    select: { branchId: true, mode: true, version: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such exam');
  if (existing.mode !== 'physical') {
    throw new AppError('STATE_CONFLICT', 'only a physical exam is editable', {
      reason: 'ONLINE_NOT_AVAILABLE',
    });
  }
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    existing.branchId ?? '',
    'no such exam',
  );
  // TD-15: a stale version is a coded conflict, never a silent overwrite.
  if (existing.version !== input.version) {
    throw new AppError('VERSION_CONFLICT', 'this exam was changed by someone else');
  }

  await prisma.$transaction(async (tx) => {
    // **Every editable field is listed here or it is silently dropped.** R57
    // found exactly that shape: a validator accepting a key while the update
    // omitted it answers `200 OK`, bumps the version, and changes nothing.
    await tx.exam.update({
      where: { id },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.date === undefined ? {} : { date: input.date }),
        ...(input.startTime === undefined ? {} : { startTime: input.startTime }),
        ...(input.endTime === undefined ? {} : { endTime: input.endTime }),
        ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
        ...(input.administrativeGroupId === undefined
          ? {}
          : { administrativeGroupId: input.administrativeGroupId }),
        version: { increment: 1 },
      },
    });

    if (input.staff !== undefined) {
      // Replaced, not merged: one call is one decision, and there is no window
      // in which the exam holds half of an intended change.
      //
      // **Soft, not hard** (R59): these rows carry `deleted_at`, and TD-5 means
      // a row with that column is never destroyed by an ordinary write. It is
      // also what makes the R59.3 restore correct — a hard delete here would
      // leave a restored exam unable to say who had been supervising it.
      // `sessionStaff` and `userBranchRole` reconcile the same way, and the
      // vocabulary is deliberately theirs rather than a third one.
      const existingStaff = await tx.examStaff.findMany({ where: { examId: id } });
      const wanted = new Map(input.staff.map((p) => [p.userId, p.position]));

      for (const row of existingStaff) {
        const position = wanted.get(row.userId);
        if (position === undefined) {
          if (row.deletedAt === null) {
            await tx.examStaff.update({
              where: { id: row.id },
              data: { deletedAt: new Date(), deletedById: actor.userId },
            });
          }
        } else {
          // Revived rather than re-inserted: `@@unique([examId, userId])` is not
          // filtered on `deleted_at`, so a tombstoned row still occupies the pair
          // and an insert would be refused.
          await tx.examStaff.update({
            where: { id: row.id },
            data: { position, deletedAt: null, deletedById: null },
          });
        }
      }

      for (const person of input.staff) {
        if (!existingStaff.some((row) => row.userId === person.userId)) {
          await tx.examStaff.create({
            data: { examId: id, userId: person.userId, position: person.position },
          });
        }
      }
    }

    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'exam.update',
      targetEntity: 'Exam',
      targetId: id,
      detail: { fields: Object.keys(input).filter((k) => k !== 'version') },
    });
  });
}

export async function deleteExam(prisma: PrismaClient, actor: Actor, id: string): Promise<void> {
  assertCanManage(actor);
  const existing = await prisma.exam.findFirst({
    where: { id, deletedAt: null },
    select: { branchId: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', 'no such exam');
  scope.assertCanActOnBranch(
    actor.roleScopes,
    MANAGING_ROLE,
    existing.branchId ?? '',
    'no such exam',
  );

  await prisma.$transaction(async (tx) => {
    const row = await tx.exam.findUnique({ where: { id } });
    // **ONE timestamp for the whole deletion**, not one per statement.
    //
    // Each `new Date()` is a few milliseconds apart, and the restore identifies
    // *the rows this deletion removed* by comparing their tombstone against the
    // record's. Two clocks meant the staff were stamped 4 ms before the exam,
    // fell outside the window, and a restored exam came back with nobody
    // supervising it — silently, which is the failure §7 describes.
    const now = new Date();
    await tx.examStaff.updateMany({
      where: { examId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    await tx.exam.update({
      where: { id },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    // TD-5/BR-15: a soft delete without a snapshot is a row nobody can find and
    // nobody can restore — the defect M3b-46 found in Events and Schedules.
    await trash.snapshot(tx, {
      targetEntity: 'Exam',
      targetId: id,
      snapshot: JSON.parse(JSON.stringify(row)) as object,
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      actionType: 'exam.delete',
      targetEntity: 'Exam',
      targetId: id,
      detail: {},
    });
  });
}

/**
 * The projection and its type, declared together.
 *
 * `satisfies` rather than a hand-written payload type: the two cannot drift,
 * and a field added to the query is a field the DTO immediately sees.
 */
const EXAM_INCLUDE = {
  // **Names, resolved server-side.** A timetable cannot be read from ids — the
  // rule `libraryItemDto` states and R55.1 applied to schedules.
  level: { select: { name: true } },
  subject: { select: { name: true } },
  branch: { select: { name: true } },
  room: { select: { name: true } },
  administrativeGroup: { select: { name: true } },
  staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
} satisfies Prisma.ExamInclude;

export type ExamRow = Prisma.ExamGetPayload<{ include: typeof EXAM_INCLUDE }>;

export async function listExams(
  prisma: PrismaClient,
  actor: Actor,
  filters: { branchId?: string; levelId?: string; from?: Date; to?: Date } & PageParams,
): Promise<Page<ExamRow>> {
  assertCanManage(actor);
  const reachable = scope.reachableBranches(actor.roleScopes, [MANAGING_ROLE]);

  const where: Prisma.ExamWhereInput = {
    deletedAt: null,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.levelId ? { levelId: filters.levelId } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    // Applied last, so an explicit filter narrows a scoped caller and never
    // widens them — the discipline every other list in the platform uses.
    ...(reachable === null ? {} : { branchId: { in: reachable } }),
  };

  const window = pageWindow(filters);
  const [rows, total] = await Promise.all([
    prisma.exam.findMany({
      where,
      skip: window.skip,
      take: window.take,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      include: EXAM_INCLUDE,
    }),
    prisma.exam.count({ where }),
  ]);
  return page(rows, window, total);
}

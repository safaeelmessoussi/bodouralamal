import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import type { Actor } from '../policies/actor.js';
import * as audit from '../repositories/audit.repository.js';
import {
  assertCanManage,
  assertCoherent,
  assertScope,
  type ExamStaffInput,
} from './exam.service.js';
import { assertStaffAccountsAvailable } from './staffing-integrity.service.js';
import { assertTypeOfKind } from './scheduling-type.service.js';
import { notifyExamCreated } from './notification.service.js';
import {
  assertMayAuthor,
  copyContentIntoNewRow,
  loadForAuthor,
  publishOccurrenceTx,
  resolveTarget,
  type AssessmentTarget,
} from './assessment.service.js';

/**
 * **R136 — الجدولة: the one place a physical or remote exam OCCURRENCE is
 * created, always as an independent copy of its reusable source, always in
 * one atomic transaction.**
 *
 * ## Why one function, not three routes composed at the API layer
 *
 * The R134-era shape — `POST /assessments/{id}/copy`, then
 * `PATCH /assessments/{id}/target`, then `POST /assessments/{id}/publish`,
 * called in sequence from the client — is exactly Codex B1: each opened its
 * own transaction, so a failure between steps could leave an orphan copy, a
 * half-assigned target, or a publication whose notified audience no longer
 * matched what a concurrent step had since written. This function performs
 * the whole sequence — authorize the source → copy it → assign occurrence
 * facts → set availability → freeze/publish → notify — inside ONE
 * `prisma.$transaction`, reading and locking everything it depends on inside
 * that same transaction rather than trusting a value read before it opened.
 * Nothing partially completes: either the whole occurrence exists, scheduled,
 * published and notified, or none of it does.
 *
 * ## Reusable source vs. occurrence — the discipline this function is
 *
 * `Exam.status = 'draft'` is a reusable source, reliably, because this
 * function is the ONLY path that ever moves a row past `draft`, and it always
 * does so on a freshly copied row, never on the source itself (R136 clause 3/
 * §2 of the ratified proposal). The source's own `status` never changes here.
 */

export type AvailabilityPolicy =
  | { policy: 'manual' }
  | { policy: 'at_start' }
  | { policy: 'offset_minutes'; minutes: number }
  | { policy: 'custom'; at: Date };

export interface ScheduleExamInput {
  mode: 'physical' | 'online';
  /** Required for `online` (R136 clause 11/14); optional for `physical`,
   *  which keeps its existing content-free path (R136 §19). */
  sourceExamId?: string | null;
  target: AssessmentTarget;
  date?: Date;
  startTime?: Date | null;
  endTime?: Date | null;
  /** Physical only. */
  branchId?: string | null;
  roomId?: string | null;
  schedulingTypeId?: string | null;
  visibility?: 'public' | 'private' | 'hidden';
  staff?: ExamStaffInput[];
  /** Remote only; ignored for physical. Absent means manual (`availableFrom`
   *  stays `NULL`). */
  availability?: AvailabilityPolicy;
  /** Required when no `sourceExamId` (a bare physical exam has no source to
   *  take title/maximum/Level/Subject from). Ignored when a source is given —
   *  the source's own content is always authoritative for what it is used as. */
  bare?: {
    title: string;
    maxGrade: number;
    description?: string | null;
    levelId: string;
    subjectId: string;
    academicYearId: string;
  };
}

function computeAvailableFrom(
  policy: AvailabilityPolicy | undefined,
  startTime: Date | null,
  date: Date,
): Date | null {
  if (policy === undefined || policy.policy === 'manual') return null;
  if (policy.policy === 'custom') return policy.at;
  // `at_start`/`offset_minutes` both need a real clock start to anchor on —
  // refused earlier, at input validation, when one is absent.
  const start = startTime as Date;
  const anchor = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      0,
      0,
    ),
  );
  if (policy.policy === 'at_start') return anchor;
  return new Date(anchor.getTime() + policy.minutes * 60_000);
}

/**
 * `POST /schedules/exams` (or wherever الجدولة's canonical write lands) —
 * one حفظ, one atomic scheduling operation, for both delivery modes.
 */
export async function scheduleExam(
  prisma: PrismaClient,
  actor: Actor,
  input: ScheduleExamInput,
): Promise<{ id: string }> {
  if (input.mode === 'online' && !input.sourceExamId) {
    throw new AppError('VALIDATION_FAILED', 'a remote exam needs authored content', {
      reason: 'SOURCE_REQUIRED',
    });
  }
  if (
    input.mode === 'online' &&
    input.availability !== undefined &&
    (input.availability.policy === 'at_start' || input.availability.policy === 'offset_minutes') &&
    !input.startTime
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      'this availability policy needs a start time to anchor on',
      { reason: 'AVAILABILITY_NEEDS_START_TIME' },
    );
  }
  if (input.mode === 'physical') {
    assertCanManage(actor);
    if (!input.branchId || !input.roomId || !input.startTime || !input.endTime) {
      throw new AppError('VALIDATION_FAILED', 'a physical exam needs its place and clock window', {
        reason: 'PHYSICAL_PLACE_REQUIRED',
      });
    }
  }
  if (!input.sourceExamId && !input.bare) {
    throw new AppError('VALIDATION_FAILED', 'a bare physical exam needs its own content fields', {
      reason: 'BARE_CONTENT_REQUIRED',
    });
  }

  return prisma.$transaction(async (tx) => {
    let occurrence: { id: string };
    let resolvedLevelId: string;
    let resolvedSubjectId: string | null;
    let resolvedAcademicYearId: string | null;

    if (input.sourceExamId) {
      // `loadForAuthor` locks nothing itself, but every write below re-derives
      // and re-asserts against the FRESH row it reads inside this same
      // transaction — never a value carried in from before it opened.
      const source = await loadForAuthor(tx as unknown as PrismaClient, actor, input.sourceExamId);
      if (source.mode !== input.mode) {
        throw new AppError('NOT_FOUND', 'no such reusable source');
      }
      if (source.status !== 'draft') {
        // R136 §2 — a row that is not `draft` is already a scheduled
        // occurrence, never a reusable source; offering it again here would
        // be exactly the source→A→B chain R136 clause 4/5 forbids.
        throw new AppError(
          'STATE_CONFLICT',
          'this paper is already a scheduled occurrence, not a reusable source',
          { reason: 'SOURCE_ALREADY_SCHEDULED' },
        );
      }

      const target = await resolveTarget(tx, {
        levelId: source.levelId,
        target: input.target,
        ...(input.date === undefined ? {} : { date: input.date }),
      });
      await assertMayAuthor(tx, actor, {
        levelId: source.levelId,
        subjectId: source.subjectId,
        branchId: null,
        administrativeGroupId: target.administrativeGroupId,
        studentId: target.studentId,
        targetKind: input.target.kind,
        sessionId: target.sessionId,
        teachingGroupId: target.teachingGroupId,
        date: target.date,
      });

      occurrence = await copyContentIntoNewRow(tx, source, {
        mode: input.mode,
        date: target.date,
        titleSuffix: false,
        target: {
          targetKind: input.target.kind,
          administrativeGroupId: target.administrativeGroupId,
          sessionId: target.sessionId,
          teachingGroupId: target.teachingGroupId,
          studentId: target.studentId,
        },
      });
      resolvedLevelId = source.levelId;
      resolvedSubjectId = source.subjectId;
      resolvedAcademicYearId = source.academicYearId;
    } else {
      // **Bare physical — the existing, unchanged, content-free path** (R136
      // §19/clause 14): scheduling without ever having selected authored
      // content, preserved exactly for simple/grade-only/externally-prepared
      // exams.
      const bare = input.bare!;
      const target = await resolveTarget(tx, {
        levelId: bare.levelId,
        target: input.target,
        ...(input.date === undefined ? {} : { date: input.date }),
      });
      await assertScope(
        tx,
        actor,
        {
          branchId: input.branchId!,
          levelId: bare.levelId,
          subjectId: bare.subjectId,
          administrativeGroupId: target.administrativeGroupId,
        },
      );
      await assertCoherent(tx, {
        levelId: bare.levelId,
        subjectId: bare.subjectId,
        academicYearId: bare.academicYearId,
        branchId: input.branchId!,
        roomId: input.roomId!,
        administrativeGroupId: target.administrativeGroupId,
      });
      occurrence = await tx.exam.create({
        data: {
          mode: 'physical',
          status: 'draft',
          title: bare.title,
          description: bare.description ?? null,
          maxGrade: bare.maxGrade,
          levelId: bare.levelId,
          subjectId: bare.subjectId,
          academicYearId: bare.academicYearId,
          targetKind: input.target.kind as never,
          administrativeGroupId: target.administrativeGroupId,
          sessionId: target.sessionId,
          teachingGroupId: target.teachingGroupId,
          studentId: target.studentId,
          date: target.date,
        },
        select: { id: true },
      });
      resolvedLevelId = bare.levelId;
      resolvedSubjectId = bare.subjectId;
      resolvedAcademicYearId = bare.academicYearId;
    }

    // ── Physical-only occurrence facts: place, clock window, staff. ────────
    if (input.mode === 'physical') {
      if (input.schedulingTypeId) {
        await assertTypeOfKind(tx, input.schedulingTypeId, ['exam'] as const);
      }
      const seen = new Set<string>();
      for (const person of input.staff ?? []) {
        if (seen.has(person.userId)) {
          throw new AppError('VALIDATION_FAILED', 'one person holds one position on one exam', {
            reason: 'EXAM_STAFF_DUPLICATE',
          });
        }
        seen.add(person.userId);
      }
      await tx.exam.update({
        where: { id: occurrence.id },
        data: {
          branchId: input.branchId as string,
          roomId: input.roomId as string,
          startTime: input.startTime as Date,
          endTime: input.endTime as Date,
          schedulingTypeId: input.schedulingTypeId ?? null,
          ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        },
      });
      for (const person of input.staff ?? []) {
        await tx.examStaff.create({
          data: { examId: occurrence.id, userId: person.userId, position: person.position },
        });
      }
      await assertStaffAccountsAvailable(
        tx,
        (input.staff ?? []).map((person) => person.userId),
      );
    } else {
      // ── Remote-only: the clock window is optional context (R136 clause 6),
      // and `availableFrom` is the one authoritative access fact (clause 9).
      if (input.startTime || input.endTime) {
        await tx.exam.update({
          where: { id: occurrence.id },
          data: { startTime: input.startTime ?? null, endTime: input.endTime ?? null },
        });
      }
      if (input.visibility !== undefined) {
        await tx.exam.update({ where: { id: occurrence.id }, data: { visibility: input.visibility } });
      }
    }

    const fresh = await tx.exam.findUniqueOrThrow({
      where: { id: occurrence.id },
      select: {
        id: true,
        targetKind: true,
        levelId: true,
        branchId: true,
        administrativeGroupId: true,
        sessionId: true,
        teachingGroupId: true,
        studentId: true,
        subjectId: true,
        date: true,
        startTime: true,
      },
    });

    if (input.mode === 'online') {
      const availableFrom = computeAvailableFrom(input.availability, fresh.startTime, fresh.date);
      if (availableFrom) {
        await tx.exam.update({ where: { id: occurrence.id }, data: { availableFrom } });
      }
      const published = await publishOccurrenceTx(tx, actor, fresh);
      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: actor.activeRole,
        actionType: 'exam.schedule',
        targetEntity: 'Exam',
        targetId: occurrence.id,
        detail: {
          mode: 'online',
          source_exam_id: input.sourceExamId ?? null,
          target_kind: input.target.kind,
          level_id: resolvedLevelId,
          subject_id: resolvedSubjectId,
          academic_year_id: resolvedAcademicYearId,
          question_count: published.questionCount,
          notified_students: published.notifiedStudents,
          notified_staff: published.notifiedStaff,
          available_from: availableFrom ? availableFrom.toISOString() : null,
        },
      });
    } else {
      await tx.exam.update({
        where: { id: occurrence.id },
        data: { status: 'published', publishedAt: new Date() },
      });
      const told = await notifyExamCreated(
        tx,
        occurrence.id,
        {
          levelId: fresh.levelId,
          administrativeGroupId: fresh.administrativeGroupId,
          // A physical occurrence always has a real branch by this point —
          // validated above (bare requires it; a source-attached one inherits
          // it from the same physical-place update just written.
          branchId: fresh.branchId as string,
          visibility: input.visibility ?? 'public',
        },
        (input.staff ?? []).map((person) => ({ userId: person.userId, position: person.position })),
        actor.userId,
      );
      await audit.write(tx, {
        actorUserId: actor.userId,
        activeRole: actor.activeRole,
        actionType: 'exam.schedule',
        targetEntity: 'Exam',
        targetId: occurrence.id,
        detail: {
          mode: 'physical',
          source_exam_id: input.sourceExamId ?? null,
          branch_id: fresh.branchId,
          date: fresh.date.toISOString(),
          visibility: input.visibility ?? 'public',
          assigned_staff: told.assigned,
          notified_students: told.scheduled,
        },
      });
    }

    return { id: occurrence.id };
  });
}

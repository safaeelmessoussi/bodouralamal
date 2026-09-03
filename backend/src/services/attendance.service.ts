import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { expandEvent } from '../lib/recurrence.js';
import type { Actor } from '../policies/actor.js';
import * as scope from '../policies/branch-scope.js';
import { calendarDay } from '../policies/effective-staffing.js';
import {
  audienceForSession,
  audienceWhere,
  enrolmentInPeriodOn,
  eventAudienceWhere,
  staffsSession,
} from '../policies/roster-resolution.js';
import * as audit from '../repositories/audit.repository.js';
import * as trash from '../repositories/trash.repository.js';
import { assertMayEdit as assertMayEditEvent } from './event.service.js';

/**
 * **Attendance — who was actually present at an occurrence** (SRS §4.7, R123).
 *
 * ## What the association does, and what this reproduces
 *
 * A paper sheet per class or activity. Two kinds exist and the difference is
 * the whole design: a **register** opens with the enrolled names already on it
 * and the marker ticks the ones who came; a **blank list** starts empty and
 * names are written as people arrive. `SchedulingType.attendance_mode` says
 * which sheet an occurrence gets — `required`, `optional`, or `disabled` for
 * the two the Owner excluded outright (عطلة and حفل).
 *
 * ## A row IS the presence
 *
 * There is no absence row and no status column. Present is a live `Attendance`
 * row; not marked is the absence of one. Creating an "absent" row per expected
 * person per occurrence would generate thousands of rows recording that nothing
 * happened, and §4.7 makes attendance informational — it gates nothing
 * (BR-11), so a missing row never has to be defended as a decision. An absence
 * in this association routinely means *watched the recording*.
 *
 * ## The expected roster is a query, never a copy
 *
 * §20 rule 22 forbids storing an audience, and nothing here does. The roster is
 * resolved from enrolment at read time against the `AcademicPeriod` covering
 * **the occurrence's own date** (R122) — so a sheet read years later still
 * shows who was expected *then*, and today's enrolment changes cannot rewrite
 * it. What was actually recorded is the `Attendance` rows, which never move.
 *
 * ## Enrolment decides EXPECTED, never ALLOWED
 *
 * A beneficiary who is not enrolled in this class may still have attended, and
 * the marker adds her. Refusing a mark for want of an enrolment would make the
 * platform contradict the register in front of the person using it.
 */

/** The three dated occurrence carriers. There is no fourth, and no abstraction
 *  over them — §4.4 has one entity per kind and inventing a shared table would
 *  be the parallel model rule 24 forbids. */
export type OccurrenceKind = 'session' | 'event' | 'exam';

export interface OccurrenceRef {
  kind: OccurrenceKind;
  id: string;
  /** Required for `event` — a recurring activity is one row expanded over many
   *  dates, so the date is half of the occurrence's identity. Ignored for the
   *  other two, whose date is on the row. */
  date?: Date;
}

export interface AttendanceSheet {
  kind: OccurrenceKind;
  occurrenceId: string;
  occurrenceDate: Date;
  mode: 'optional' | 'required';
  marking: 'staff_only' | 'self_or_staff';
  /** Whether THIS caller may mark herself here — the three conditions resolved
   *  once, server-side, so the client renders a button rather than deciding a
   *  permission (rule O). */
  selfCheckInAvailable: boolean;
  /** Empty for an `optional` occurrence: its sheet starts blank. */
  expected: { id: string; name: string | null }[];
  present: {
    id: string;
    studentId: string;
    name: string | null;
    recordedAt: Date;
    /** `true` when the beneficiary recorded it herself. Derived from
     *  `marked_by`, which is why no `source` column exists. */
    self: boolean;
    /** `true` when she is not on the expected roster — the «حضرت رغم أنها غير
     *  مسجَّلة» case the paper sheet writes in the margin. */
    beyondRoster: boolean;
  }[];
}

/* ── Resolving the occurrence, and refusing the excluded ones ─────────────── */

interface ResolvedOccurrence {
  kind: OccurrenceKind;
  id: string;
  date: Date;
  /** Never `disabled` — `requireAttendanceMode` has already refused those, so
   *  every path downstream of a resolved occurrence is one that has a sheet. */
  mode: 'optional' | 'required';
  marking: 'staff_only' | 'self_or_staff';
  /** The audience predicate for this occurrence, or `null` when it addresses
   *  nobody in particular (a global Event) — see `eventAudienceWhere`. */
  audience: Prisma.UserWhereInput | null;
}

/**
 * **The exclusion is enforced here, once, for every path.**
 *
 * Reading a sheet, marking somebody, self-marking and removing a mark all pass
 * through this function, so «vacations and parties have no attendance» cannot
 * be true on one route and false on another. Hiding the button was never the
 * mechanism.
 *
 * **An occurrence with no scheduling type is refused too.** Every row created
 * before R110 records none, and nothing in it says what it was — inferring a
 * type from a title is exactly the name-matching §4.4b forbids. *We do not know
 * whether this may take attendance* is honestly answered by refusing, not by
 * guessing the permissive branch.
 */
async function resolveOccurrence(
  prisma: PrismaClient | Prisma.TransactionClient,
  ref: OccurrenceRef,
): Promise<ResolvedOccurrence> {
  const notFound = new AppError('NOT_FOUND', 'no such occurrence');

  if (ref.kind === 'session') {
    const session = await prisma.session.findFirst({
      where: { id: ref.id, deletedAt: null },
      select: {
        id: true,
        date: true,
        schedule: {
          select: { attendanceMarking: true, schedulingType: { select: { attendanceMode: true } } },
        },
      },
    });
    if (!session?.schedule) throw notFound;
    const mode = requireAttendanceMode(session.schedule.schedulingType?.attendanceMode);
    // The occurrence's own date narrows the roster to the period it fell in.
    const spec = await audienceForSession(prisma, ref.id, 'occurrence');
    return {
      kind: 'session',
      id: session.id,
      date: session.date,
      mode,
      marking: session.schedule.attendanceMarking,
      audience: spec === null ? null : audienceWhere(spec),
    };
  }

  if (ref.kind === 'exam') {
    const exam = await prisma.exam.findFirst({
      where: { id: ref.id, deletedAt: null },
      select: {
        id: true,
        date: true,
        levelId: true,
        branchId: true,
        administrativeGroupId: true,
        schedulingType: { select: { attendanceMode: true } },
      },
    });
    if (!exam) throw notFound;
    const mode = requireAttendanceMode(exam.schedulingType?.attendanceMode);
    return {
      kind: 'exam',
      id: exam.id,
      date: exam.date,
      mode,
      // **No column, and none is wanted.** A sitting is invigilated; self-marking
      // an exam is not a workflow the association has, so offering a setting
      // whose only correct value is the default would be a configuration trap.
      marking: 'staff_only',
      audience: audienceWhere(
        exam.administrativeGroupId === null
          ? {
              teachingMode: 'entire_level',
              levelId: exam.levelId,
              administrativeGroupId: null,
              teachingGroupId: null,
              branchId: exam.branchId ?? '',
              on: exam.date,
            }
          : {
              teachingMode: 'administrative_group',
              levelId: null,
              administrativeGroupId: exam.administrativeGroupId,
              teachingGroupId: null,
              branchId: exam.branchId ?? '',
              on: exam.date,
            },
      ),
    };
  }

  const event = await prisma.event.findFirst({
    where: { id: ref.id, deletedAt: null },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      recurrenceType: true,
      recurrenceEndDate: true,
      attendanceMarking: true,
      schedulingType: { select: { attendanceMode: true } },
      branchScopes: { select: { branchId: true } },
      categoryScopes: { select: { categoryId: true } },
      levelScopes: { select: { levelId: true } },
      administrativeGroupScopes: { select: { administrativeGroupId: true } },
    },
  });
  if (!event) throw notFound;
  const mode = requireAttendanceMode(event.schedulingType?.attendanceMode);
  const date = requireEventOccurrenceDate(event, ref.date);
  return {
    kind: 'event',
    id: event.id,
    date,
    mode,
    marking: event.attendanceMarking,
    audience: eventAudienceWhere(
      {
        branchIds: event.branchScopes.map((b) => b.branchId),
        categoryIds: event.categoryScopes.map((c) => c.categoryId),
        levelIds: event.levelScopes.map((l) => l.levelId),
        administrativeGroupIds: event.administrativeGroupScopes.map(
          (g) => g.administrativeGroupId,
        ),
      },
      date,
    ),
  };
}

function requireAttendanceMode(
  mode: 'disabled' | 'optional' | 'required' | undefined | null,
): 'optional' | 'required' {
  if (mode === undefined || mode === null || mode === 'disabled') {
    throw new AppError('STATE_CONFLICT', 'this kind of activity takes no attendance', {
      reason: 'ATTENDANCE_NOT_AVAILABLE',
    });
  }
  return mode;
}

/**
 * **The requested day must be one this activity actually occurs on.**
 *
 * A recurring نشاط is one row; `expandEvent` says which dates it produces.
 * Accepting any date would let a caller open a sheet for a day the activity did
 * not happen and record presence at nothing — and, because the date is half the
 * unique key, it would do so without ever colliding with the real one.
 */
function requireEventOccurrenceDate(
  event: {
    startDate: Date;
    endDate: Date | null;
    recurrenceType: string;
    recurrenceEndDate: Date | null;
  },
  requested: Date | undefined,
): Date {
  if (requested === undefined) {
    throw new AppError('VALIDATION_FAILED', 'an activity occurrence needs its date', {
      reason: 'OCCURRENCE_DATE_REQUIRED',
    });
  }
  const day = calendarDay(requested);
  const occurs = expandEvent(event, day, day).length > 0;
  if (!occurs) throw new AppError('NOT_FOUND', 'no such occurrence');
  return day;
}

/* ── Who may mark ─────────────────────────────────────────────────────────── */

const MANAGING_ROLE = 'admin';

/**
 * **Staff authority, delegated to the rule each occurrence kind already has.**
 *
 * No new permission system (§6 of the Owner's brief): a Session is marked by
 * whoever staffs *that occurrence on its date* (R91's `staffsSession`, which is
 * the only honest answer for a past class), an Event by whoever may edit it
 * (R71's responsible person, an Admin in scope, a Super Admin), an Exam by its
 * supervisor or an Admin in the branch. Attendance invents no reach of its own,
 * so widening any of those later widens attendance with them rather than
 * leaving a second matrix behind.
 */
async function assertMayMark(
  prisma: PrismaClient,
  tx: Prisma.TransactionClient,
  actor: Actor,
  occurrence: ResolvedOccurrence,
): Promise<void> {
  if (scope.isSuperAdmin(actor.roleScopes)) return;

  if (occurrence.kind === 'event') {
    await assertMayEditEvent(tx, actor, occurrence.id);
    return;
  }

  if (occurrence.kind === 'session') {
    if (await staffsSession(prisma, actor.userId, occurrence.id)) return;
    await assertAdminInOccurrenceBranch(tx, actor, occurrence);
    return;
  }

  const supervises = await tx.examStaff.count({
    where: {
      examId: occurrence.id,
      userId: actor.userId,
      position: 'supervisor',
      deletedAt: null,
    },
  });
  if (supervises > 0) return;
  await assertAdminInOccurrenceBranch(tx, actor, occurrence);
}

/** Out of scope answers `404`, never `403` (§20 rule 17) — a 403 would confirm
 *  the occurrence exists somewhere the caller may not look. */
async function assertAdminInOccurrenceBranch(
  tx: Prisma.TransactionClient,
  actor: Actor,
  occurrence: ResolvedOccurrence,
): Promise<void> {
  if (!scope.hasRole(actor.roleScopes, MANAGING_ROLE)) {
    throw new AppError('NOT_FOUND', 'no such occurrence');
  }
  const branchId =
    occurrence.kind === 'session'
      ? (
          await tx.session.findUniqueOrThrow({
            where: { id: occurrence.id },
            select: { schedule: { select: { branchId: true } } },
          })
        ).schedule.branchId
      : ((
          await tx.exam.findUniqueOrThrow({
            where: { id: occurrence.id },
            select: { branchId: true },
          })
        ).branchId ?? null);
  if (branchId === null) throw new AppError('NOT_FOUND', 'no such occurrence');
  scope.assertCanActOnBranch(actor.roleScopes, MANAGING_ROLE, branchId, 'no such occurrence');
}

/**
 * **Self check-in — three conditions, and the third is the one the Owner
 * insisted the server hold.**
 *
 * 1. The occurrence is configured `self_or_staff`.
 * 2. The caller is marking **herself** — the route never accepts a student id.
 * 3. **Every Category she is enrolled in permits it.** اليافعات and الطفل do
 *    not, and a teen or a child must never self-mark *even if a schedule
 *    accidentally says `self_or_staff`*. Read from
 *    `Category.self_attendance_allowed` rather than the Category's name, which
 *    §4.4b forbids, and rather than `schooling_stage`, which R62.7 says gates
 *    nothing.
 *
 * **«Every», not «any»**, deliberately: a beneficiary enrolled in both an
 * adult and a teen Category is refused. That direction is the safe one, and it
 * needs no tie-break rule nobody has decided.
 */
async function assertMaySelfMark(
  tx: Prisma.TransactionClient,
  actor: Actor,
  occurrence: ResolvedOccurrence,
): Promise<void> {
  if (occurrence.marking !== 'self_or_staff') {
    throw new AppError('FORBIDDEN', 'attendance here is recorded by staff', {
      reason: 'SELF_CHECK_IN_NOT_ALLOWED',
    });
  }
  if (!(await selfMarkingPermittedFor(tx, actor.userId))) {
    throw new AppError('FORBIDDEN', 'attendance here is recorded by staff', {
      reason: 'SELF_CHECK_IN_NOT_ALLOWED',
    });
  }
}

/**
 * The Category half of the rule, alone, so a caller can answer *may I* without
 * raising and catching an error to find out.
 *
 * **Exported for `GET /me`**, on the same footing as `teaches_quran` (R87 §M):
 * a structurally-derived capability the client cannot compute for itself —
 * it would need every enrolment and every Category — and which decides whether
 * a control is offered at all. اليافعات and الطفل must see **no** self
 * check-in control, and pre-hiding it is only possible if the server says so.
 */
export async function selfMarkingPermittedFor(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const enrolments = await tx.enrollment.findMany({
    where: { studentId: userId, deletedAt: null },
    select: { level: { select: { category: { select: { selfAttendanceAllowed: true } } } } },
  });
  if (enrolments.length === 0) return false;
  return enrolments.every((e) => e.level.category.selfAttendanceAllowed);
}

/* ── Reading the sheet ────────────────────────────────────────────────────── */

export async function attendanceSheet(
  prisma: PrismaClient,
  actor: Actor,
  ref: OccurrenceRef,
): Promise<AttendanceSheet> {
  const occurrence = await resolveOccurrence(prisma, ref);
  await assertMayMark(prisma, prisma, actor, occurrence);

  /**
   * **`required` opens on the roster; `optional` opens empty.**
   *
   * Not a presentation choice: prefilling an optional sheet would put every
   * enrolled name on a list the association keeps precisely because it does not
   * know in advance who will come, and the marker would have to un-tick rather
   * than tick.
   */
  const expected =
    occurrence.mode === 'required' && occurrence.audience !== null
      ? await prisma.user.findMany({
          where: occurrence.audience,
          select: { id: true, nameArabic: true },
          orderBy: { nameArabic: 'asc' },
        })
      : [];

  const rows = await prisma.attendance.findMany({
    where: { ...occurrenceWhere(occurrence), deletedAt: null },
    select: {
      id: true,
      studentId: true,
      markedById: true,
      recordedAt: true,
      student: { select: { nameArabic: true } },
    },
    orderBy: { recordedAt: 'asc' },
  });

  const expectedIds = new Set(expected.map((e) => e.id));
  return {
    kind: occurrence.kind,
    occurrenceId: occurrence.id,
    occurrenceDate: occurrence.date,
    mode: occurrence.mode,
    marking: occurrence.marking,
    selfCheckInAvailable:
      occurrence.marking === 'self_or_staff' &&
      (await selfMarkingPermittedFor(prisma, actor.userId)),
    expected: expected.map((e) => ({ id: e.id, name: e.nameArabic })),
    present: rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      name: r.student.nameArabic,
      recordedAt: r.recordedAt,
      self: r.markedById === r.studentId,
      beyondRoster: !expectedIds.has(r.studentId),
    })),
  };
}

function occurrenceWhere(occurrence: {
  kind: OccurrenceKind;
  id: string;
  date: Date;
}): Prisma.AttendanceWhereInput {
  switch (occurrence.kind) {
    case 'session':
      return { sessionId: occurrence.id };
    case 'exam':
      return { examId: occurrence.id };
    case 'event':
      // The date is half the occurrence's identity for a recurring activity.
      return { eventId: occurrence.id, occurrenceDate: occurrence.date };
  }
}

/* ── Marking ──────────────────────────────────────────────────────────────── */

/**
 * **Idempotent by construction** (§7 of the Owner's brief).
 *
 * The partial unique index is the enforcement — a double-tap on «تسجيل حضوري»
 * races past any check-then-insert — and this returns the existing row rather
 * than raising, because *«I am present»* sent twice is not an error the person
 * can act on. A soft-deleted row is revived rather than duplicated: the index
 * is partial, so re-marking somebody whose mark was removed would otherwise
 * leave two rows, one of them a tombstone that the sheet must then be careful
 * to ignore forever.
 */
export async function markPresent(
  prisma: PrismaClient,
  actor: Actor,
  ref: OccurrenceRef,
  studentId: string,
  options: { self?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  const occurrence = await resolveOccurrence(prisma, ref);

  return prisma.$transaction(async (tx) => {
    if (options.self === true) {
      if (studentId !== actor.userId) {
        // A woman marks ONLY herself. The route does not accept a student id at
        // all; this is the backstop that makes that structural rather than a
        // property of one controller.
        throw new AppError('FORBIDDEN', 'self check-in records only your own presence', {
          reason: 'SELF_CHECK_IN_OTHER_PERSON',
        });
      }
      await assertMaySelfMark(tx, actor, occurrence);
    } else {
      await assertMayMark(prisma, tx, actor, occurrence);
    }

    /**
     * **A beneficiary, not any User.** The sheet records people the association
     * has registered — §4.7 says *per student*, and a free-text name would be a
     * second, unverifiable identity beside the one the platform already holds.
     * Enrolment is NOT required: it decides who is *expected*, never who is
     * *allowed* (§4 of the brief).
     */
    const student = await tx.user.findFirst({
      where: { id: studentId, deletedAt: null, isBeneficiary: true },
      select: { id: true },
    });
    if (!student) throw new AppError('NOT_FOUND', 'no such beneficiary');

    const where = { ...occurrenceWhere(occurrence), studentId };
    const existing = await tx.attendance.findFirst({
      where,
      select: { id: true, deletedAt: true },
    });
    if (existing && existing.deletedAt === null) return { id: existing.id, created: false };

    const row = existing
      ? await tx.attendance.update({
          where: { id: existing.id },
          data: { deletedAt: null, deletedById: null, markedById: actor.userId },
          select: { id: true },
        })
      : await tx.attendance.create({
          data: {
            ...occurrenceKey(occurrence),
            occurrenceDate: occurrence.date,
            studentId,
            markedById: actor.userId,
          },
          select: { id: true },
        });

    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: options.self === true ? 'attendance.self' : 'attendance.mark',
      targetEntity: 'Attendance',
      targetId: row.id,
      // **Ids and a date, never a name** (TD-14). `assertMinimizedDetail`
      // refuses a copied identity outright, and this row is about a minor often
      // enough that the rule has to be mechanical rather than remembered.
      detail: {
        occurrence_kind: occurrence.kind,
        occurrence_id: occurrence.id,
        occurrence_date: occurrence.date.toISOString().slice(0, 10),
        student_id: studentId,
      },
    });
    return { id: row.id, created: true };
  });
}

function occurrenceKey(occurrence: { kind: OccurrenceKind; id: string }): {
  sessionId?: string;
  eventId?: string;
  examId?: string;
} {
  switch (occurrence.kind) {
    case 'session':
      return { sessionId: occurrence.id };
    case 'exam':
      return { examId: occurrence.id };
    case 'event':
      return { eventId: occurrence.id };
  }
}

/**
 * **Removing a mistaken mark** — a soft delete with a Trash snapshot and an
 * audit row in one transaction (§20 rule 11, TD-5).
 *
 * Never a hard delete: *she was marked and then unmarked* is a correction a
 * register has to be able to show, and a row that disappears leaves the
 * administrator who removed it with nothing to point at.
 *
 * **Staff only, including on a self-marked row.** A woman may record her own
 * presence; withdrawing a record of what happened is an administrative act.
 */
export async function removeAttendance(
  prisma: PrismaClient,
  actor: Actor,
  ref: OccurrenceRef,
  studentId: string,
): Promise<void> {
  const occurrence = await resolveOccurrence(prisma, ref);

  await prisma.$transaction(async (tx) => {
    await assertMayMark(prisma, tx, actor, occurrence);

    const row = await tx.attendance.findFirst({
      where: { ...occurrenceWhere(occurrence), studentId, deletedAt: null },
      select: {
        id: true,
        sessionId: true,
        eventId: true,
        examId: true,
        occurrenceDate: true,
        studentId: true,
        markedById: true,
        recordedAt: true,
      },
    });
    if (!row) throw new AppError('NOT_FOUND', 'no such attendance record');

    const now = new Date();
    await tx.attendance.update({
      where: { id: row.id },
      data: { deletedAt: now, deletedById: actor.userId },
    });
    await trash.snapshot(tx, {
      targetEntity: 'Attendance',
      targetId: row.id,
      snapshot: {
        ...row,
        occurrenceDate: row.occurrenceDate.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
      },
      deletedById: actor.userId,
    });
    await audit.write(tx, {
      actorUserId: actor.userId,
      activeRole: actor.activeRole,
      actionType: 'attendance.remove',
      targetEntity: 'Attendance',
      targetId: row.id,
      detail: {
        occurrence_kind: occurrence.kind,
        occurrence_id: occurrence.id,
        occurrence_date: occurrence.date.toISOString().slice(0, 10),
        student_id: studentId,
      },
    });
  });
}

/**
 * **The expected-roster predicate, exported for the tests that pin R122's rule.**
 *
 * Composed here rather than duplicated: it is `enrolmentInPeriodOn` — the one
 * definition of *which enrolments were live in the period covering a day* —
 * applied to the occurrence's own date.
 */
export function expectedAttendeesInPeriod(on: Date): Prisma.EnrollmentWhereInput {
  return { deletedAt: null, ...enrolmentInPeriodOn(on) };
}

/**
 * **Who may be ADDED to a sheet — a smaller question, never a wider
 * permission** (rule O).
 *
 * The Owner's requirement is that a beneficiary who is not enrolled in this
 * class may still be marked. Finding her needs a search, and the obvious one —
 * `GET /admin/directory` — is Admin and Super Admin only (TD-2), so a مؤطِّرة
 * marking her own class could not reach it. Widening that endpoint to teachers
 * would hand every مؤطِّرة the whole people-picker in order to solve one
 * sheet's problem; asking a **narrower question here** does not.
 *
 * The answer is deliberately small: live beneficiaries **at the occurrence's
 * own branch**, by name, capped. A person who could walk into that room is the
 * honest boundary — and the caller has already been authorised to mark this
 * occurrence before the search runs, so it discloses nothing she cannot
 * already act on. A Super Admin's occurrence-branch is still the filter: this
 * is a picker for one sheet, not a directory.
 */
export async function attendanceCandidates(
  prisma: PrismaClient,
  actor: Actor,
  ref: OccurrenceRef,
  query: string,
): Promise<{ id: string; name: string | null }[]> {
  const occurrence = await resolveOccurrence(prisma, ref);
  await assertMayMark(prisma, prisma, actor, occurrence);

  const branchId = await occurrenceBranch(prisma, occurrence);
  const trimmed = query.trim();

  return prisma.user.findMany({
    where: {
      deletedAt: null,
      isBeneficiary: true,
      ...(trimmed === '' ? {} : { nameArabic: { contains: trimmed } }),
      // An activity with no branch of its own (a global one) narrows to nothing
      // rather than opening the whole institute.
      ...(branchId === null
        ? {}
        : { levelEnrollments: { some: { deletedAt: null, branchId } } }),
      // Already on the sheet — offering her again would let a second click
      // produce a no-op the reader cannot explain.
      attendance: { none: { ...occurrenceWhere(occurrence), deletedAt: null } },
    },
    select: { id: true, nameArabic: true },
    orderBy: { nameArabic: 'asc' },
    // TD-10's page size is for lists a person reads; this is a picker, and a
    // longer answer would be scrolled rather than searched.
    take: 20,
  }).then((rows) => rows.map((r) => ({ id: r.id, name: r.nameArabic })));
}

/** The branch an occurrence happens at, or `null` where it names none. */
async function occurrenceBranch(
  prisma: PrismaClient,
  occurrence: ResolvedOccurrence,
): Promise<string | null> {
  if (occurrence.kind === 'session') {
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: occurrence.id },
      select: { schedule: { select: { branchId: true } } },
    });
    return row.schedule.branchId;
  }
  if (occurrence.kind === 'exam') {
    const row = await prisma.exam.findUniqueOrThrow({
      where: { id: occurrence.id },
      select: { branchId: true },
    });
    return row.branchId;
  }
  const rows = await prisma.eventBranch.findMany({
    where: { eventId: occurrence.id },
    select: { branchId: true },
  });
  // An activity scoped to several branches has no single one; the first is not
  // an answer, so the search is unfiltered by branch in that case and is still
  // bounded by the caller having authority over the activity itself.
  return rows.length === 1 ? rows[0]!.branchId : null;
}

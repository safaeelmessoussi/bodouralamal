import type { PrismaClient } from '../generated/prisma/client.js';
import { expandSchedule } from '../lib/recurrence.js';

/**
 * The Revision 43 educational model, as test fixtures.
 *
 * Four suites — consent, social profile, calendar and events — each need the
 * same three relationships to exist before they can assert anything about
 * scope: **a group at a branch, a student enrolled in it, and a teacher who
 * reaches that student.** Under the retired model those were three one-line
 * creates (`Group`, `StudentGroup`, `GroupTeacher`). Under §4.4c the third one
 * is no longer a row but a *path* — a teacher reaches a student through a
 * Recurring Course Schedule that targets the student's group — so each suite
 * would otherwise grow its own six-row setup, and the four copies would drift.
 *
 * This is that setup, once. It exists for the same reason `roster-resolution.ts`
 * exists: the model has one definition, and a test that builds a slightly
 * different one is testing something the application cannot produce.
 */

export interface TeachingFixture {
  categoryId: string;
  levelId: string;
  branchId: string;
  administrativeGroupId: string;
  subjectId: string;
  scheduleId: string;
  /** One materialized occurrence — what the consent gate actually attaches to. */
  sessionId: string;
}

/**
 * A cleanup prefix is an ownership boundary, not an arbitrary search term.
 *
 * `startsWith: ''` matches every row, and a malformed bracket prefix can match
 * data outside the scenario just as easily. Keep the check beside the shared
 * helper so every caller inherits it. The development seed's `[تجريبي]`
 * namespace is explicitly reserved: integration scenarios may read those rows,
 * but never claim ownership of them.
 */
export function assertTestOwnershipTag(tag: string): void {
  const bracketedPrefix = /^\[[^\[\]\r\n]{4,80}\](?: [^\r\n]{1,80})?$/.test(tag);
  if (!bracketedPrefix || tag.startsWith('[تجريبي]')) {
    throw new Error(`unsafe test ownership tag: ${JSON.stringify(tag)}`);
  }
}

/**
 * Creates a Level with one Administrative Group at `branchId`, a Subject
 * assigned to that Level, and a Recurring Course Schedule targeting the group.
 *
 * The schedule is what makes a teacher's reach expressible at all: staff attach
 * to it (`CourseScheduleStaff`), and its resolved audience is the group's
 * enrolled students (§4.4c).
 */
export async function createTeachingContext(
  prisma: PrismaClient,
  tag: string,
  branchId: string,
  opts: {
    levelId?: string;
    categoryId?: string;
    /** Defaults to Saturday; the calendar suite needs specific weekdays. */
    weekday?: string;
    /** Start hour, wall-clock (TD-11). End is one and a half hours later. */
    hour?: number;
  } = {},
): Promise<TeachingFixture> {
  assertTestOwnershipTag(tag);
  const categoryId =
    opts.categoryId ?? (await prisma.category.create({ data: { name: `${tag} فئة` } })).id;
  const levelId =
    opts.levelId ??
    (
      await prisma.level.create({
        data: { name: `${tag} مستوى`, categoryId, genderRestriction: 'any' },
      })
    ).id;

  const group = await prisma.administrativeGroup.create({
    data: { name: `${tag} مجموعة`, levelId, branchId },
  });

  const subject = await prisma.subject.create({ data: { name: `${tag} مادة` } });
  await prisma.levelSubject.create({ data: { levelId, subjectId: subject.id } });

  const academicYear = await prisma.academicYear.findFirstOrThrow({ select: { id: true } });
  const schedule = await prisma.recurringCourseSchedule.create({
    data: {
title: `${tag} حلقة`,
      subjectId: subject.id,
      teachingMode: 'administrative_group',
      administrativeGroupId: group.id,
      branchId,
      startTime: new Date(Date.UTC(1970, 0, 1, opts.hour ?? 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, (opts.hour ?? 9) + 1, 30, 0)),
      recurrence: 'weekly',
      weekdays: [(opts.weekday ?? 'saturday') as never],
      academicYearId: academicYear.id,
    },
  });

  // One materialized occurrence. A schedule with no sessions is not a realistic
  // fixture: the consent gate's subject is a SESSION's resolved audience
  // (BR-2), so a suite asserting that a change re-evaluates the gate needs
  // something for the job to name.
  const session = await prisma.session.create({
    data: {
      scheduleId: schedule.id,
      date: new Date('2026-09-12'),
      startTime: new Date(Date.UTC(1970, 0, 1, opts.hour ?? 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, (opts.hour ?? 9) + 1, 30, 0)),
    },
  });

  return {
    categoryId,
    levelId,
    branchId,
    administrativeGroupId: group.id,
    subjectId: subject.id,
    scheduleId: schedule.id,
    sessionId: session.id,
  };
}

/** Enrols a student in the fixture's group — and thereby in its Level (§4.4c). */
export async function enrol(
  prisma: PrismaClient,
  fixture: Pick<TeachingFixture, 'administrativeGroupId' | 'levelId' | 'branchId'>,
  studentId: string,
): Promise<string> {
  const row = await prisma.enrollment.create({
    data: {
      studentId,
      administrativeGroupId: fixture.administrativeGroupId,
      levelId: fixture.levelId,
      // R66 — the enrolment carries the branch. Taken from the fixture's own
      // group so the composite FK `(administrative_group_id, branch_id)` holds.
      branchId: fixture.branchId,
    },
  });
  return row.id;
}

/**
 * Staffs the fixture's schedule, which is what gives a teacher reach over its
 * students (§4.4c). Assistants have identical reach — one table, one rule.
 */
export async function staff(
  prisma: PrismaClient,
  fixture: Pick<TeachingFixture, 'scheduleId'>,
  userId: string,
  position: 'teacher' | 'assistant' = 'teacher',
): Promise<string> {
  const row = await prisma.courseScheduleStaff.create({
    data: { scheduleId: fixture.scheduleId, userId, position },
  });
  return row.id;
}

/**
 * Removes everything `createTeachingContext` and its helpers made, in
 * dependency order.
 *
 * Every FK in this model is `RESTRICT` (TD-5), so order is not cosmetic — and
 * getting it wrong leaves the previous run's rows behind for the next one to
 * trip over, which is a failure mode this project has already met twice.
 */
export async function clearTeachingContext(prisma: PrismaClient, tag: string): Promise<void> {
  assertTestOwnershipTag(tag);
  const tagged = { name: { startsWith: tag } };
  const bySubject = { schedule: { subject: tagged } };

  await prisma.sessionContent.deleteMany({ where: { session: bySubject } });
  await prisma.sessionStaff.deleteMany({ where: { session: bySubject } });
  // R77 — `notification.session_id` is RESTRICT, like every other reference
  // to a Session: a cancellation notice whose session vanished is unreadable.
  // Fixtures therefore unwind notices before the occurrences they name.
  await prisma.notification.deleteMany({ where: { session: bySubject } });
  await prisma.session.deleteMany({ where: bySubject });
  await prisma.courseScheduleStaff.deleteMany({ where: { schedule: { subject: tagged } } });
  await prisma.recurringCourseSchedule.deleteMany({ where: { subject: tagged } });
  await prisma.studentTeachingGroup.deleteMany({ where: { level: tagged } });
  await prisma.enrollment.deleteMany({ where: { level: tagged } });
  await prisma.teachingGroup.deleteMany({ where: { level: tagged } });
  await prisma.eventAdministrativeGroup.deleteMany({
    where: { administrativeGroup: { level: tagged } },
  });
  await prisma.administrativeGroup.deleteMany({ where: { level: tagged } });
  await prisma.administrativeGroup.deleteMany({ where: { branch: tagged } });
  await prisma.levelSubject.deleteMany({ where: { subject: tagged } });
  await prisma.subject.deleteMany({ where: tagged });
  await prisma.level.deleteMany({ where: tagged });
  await prisma.category.deleteMany({ where: tagged });
}

/**
 * Materializes a schedule's sessions across an arbitrary range.
 *
 * **Test-only, and deliberately unbounded by the production rules.**
 * `session.materialize` never generates the past and stops at the academic-year
 * horizon (§4.4) — both correct for the application and both useless to a suite
 * that needs occurrences in, say, February 2026 to exercise Morocco's Ramadan
 * clock shift. Those rules are the *service's* job to enforce and the service's
 * own suite proves them; a fixture that had to respect them could not set up the
 * scenario at all.
 *
 * Uses the same `expandSchedule` the job uses, so the dates are the ones
 * production would have produced.
 */
export async function materializeRange(
  prisma: PrismaClient,
  fixture: Pick<TeachingFixture, 'scheduleId'>,
  from: Date,
  to: Date,
): Promise<string[]> {
  const schedule = await prisma.recurringCourseSchedule.findUniqueOrThrow({
    where: { id: fixture.scheduleId },
    select: {
      startTime: true,
      endTime: true,
      roomId: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
    },
  });

  const ids: string[] = [];
  for (const date of expandSchedule(schedule, from, to)) {
    const row = await prisma.session.upsert({
      where: { scheduleId_date: { scheduleId: fixture.scheduleId, date } },
      create: {
        scheduleId: fixture.scheduleId,
        date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        roomId: schedule.roomId,
      },
      update: {},
      select: { id: true },
    });
    // Revision 43.4: the occurrence carries its own staffing snapshot.
    for (const s of schedule.staff) {
      await prisma.sessionStaff.upsert({
        where: { sessionId_userId: { sessionId: row.id, userId: s.userId } },
        create: { sessionId: row.id, userId: s.userId, position: s.position },
        update: { position: s.position, deletedAt: null },
      });
    }
    ids.push(row.id);
  }
  return ids;
}

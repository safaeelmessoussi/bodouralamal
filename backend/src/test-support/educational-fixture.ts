import type { PrismaClient } from '../generated/prisma/client.js';

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
  opts: { levelId?: string; categoryId?: string } = {},
): Promise<TeachingFixture> {
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
      subjectId: subject.id,
      teachingMode: 'administrative_group',
      administrativeGroupId: group.id,
      branchId,
      startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
      recurrence: 'weekly',
      weekdays: ['saturday'],
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
      startTime: new Date(Date.UTC(1970, 0, 1, 9, 0, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
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
  fixture: Pick<TeachingFixture, 'administrativeGroupId' | 'levelId'>,
  studentId: string,
): Promise<string> {
  const row = await prisma.enrollment.create({
    data: {
      studentId,
      administrativeGroupId: fixture.administrativeGroupId,
      levelId: fixture.levelId,
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
  const tagged = { name: { startsWith: tag } };
  const bySubject = { schedule: { subject: tagged } };

  await prisma.sessionContent.deleteMany({ where: { session: bySubject } });
  await prisma.sessionStaff.deleteMany({ where: { session: bySubject } });
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

import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * The far-future `AcademicYear.label` band every integration fixture mints
 * into. `label` is unique application-wide and TD-6 constrains it to
 * `YYYY-YYYY`, so a fixture year has to be minted somewhere no seeded year and
 * no concurrent suite will ever reach.
 */
const FIXTURE_LABEL_FLOOR = '2100-0000';
const FIXTURE_LABEL_CEIL = '2900-0000';

/**
 * What THIS test file provisioned. Vitest gives each test file its own module
 * instance, so these two are exactly one suite's state.
 *
 * The band must never be swept wholesale: integration suites run concurrently
 * against one database, and a sweep by label range deletes the period another
 * suite has just minted and not yet enrolled into — which then surfaces as a
 * missing record in an unrelated file.
 */
let fixtureYearId: string | null = null;
let nextSequence = 1;

/**
 * **One year per test file, one period per call.**
 *
 * A year per call read more simply and was wrong: the band holds 800 labels, a
 * suite calling this from `beforeEach` burns fifty of them, and the birthday
 * collision on a random draw arrived inside a single file. A period is unique
 * per `(year, sequence)`, so a counter inside the suite's own year cannot
 * collide with anything — including a suite running beside it.
 */
async function fixtureYear(prisma: PrismaClient): Promise<string> {
  if (fixtureYearId) return fixtureYearId;
  // Retried, because two suites can draw the same label at the same moment.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const first = 2100 + Math.floor(Math.random() * 800);
    try {
      const year = await prisma.academicYear.create({
        data: { label: `${first}-${first + 1}` },
      });
      fixtureYearId = year.id;
      return year.id;
    } catch {
      // Taken by another suite, or by an earlier draw — try another label.
    }
  }
  throw new Error('could not mint a fixture academic year: the label band is full');
}

/**
 * R122 — an `AcademicPeriod` whose dates cover today, for suites that must
 * **enrol** somebody.
 *
 * Every enrolment write now names the period it belongs to, which turned a
 * one-line `enrolStudent(…)` into something needing a calendar behind it, in
 * suites whose subject is the roster or the decision machinery rather than the
 * academic year.
 *
 * This exists so that fixture is written **once**. It was inlined in three
 * suites within a day of the column landing, and two of them had already
 * diverged on whether the year was created or upserted.
 *
 * **Not `is_current`.** Exactly one `AcademicYear` may carry that flag
 * application-wide (partial unique index), so a fixture claiming it would
 * collide with the seeded year and with every other suite. Only the DATES
 * decide whether a period is running, so the flag is not needed here.
 */
export async function provisionAcademicPeriod(prisma: PrismaClient): Promise<string> {
  const academicYearId = await fixtureYear(prisma);
  const today = new Date();
  const period = await prisma.academicPeriod.create({
    data: {
      academicYearId,
      sequence: nextSequence,
      startDate: new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)),
      endDate: new Date(Date.UTC(today.getUTCFullYear() + 1, 11, 31)),
    },
  });
  nextSequence += 1;
  return period.id;
}

/**
 * Releases the year and periods THIS suite provisioned.
 *
 * **Call it AFTER deleting the suite's enrolments** — `academic_period_id` is
 * `ON DELETE RESTRICT`. A period an enrolment still names is skipped rather
 * than allowed to fail the teardown: a suite deliberately keeping a row past
 * its own `afterAll` is holding a real reference, not leaking one.
 *
 * The label band is asserted rather than used as the selector — it is the
 * backstop that keeps a bug in this helper from ever reaching a seeded year.
 */
export async function releaseAcademicPeriods(prisma: PrismaClient): Promise<void> {
  if (!fixtureYearId) return;
  const year = await prisma.academicYear.findFirst({
    where: {
      id: fixtureYearId,
      label: { gte: FIXTURE_LABEL_FLOOR, lte: FIXTURE_LABEL_CEIL },
    },
    select: { periods: { select: { id: true, enrollments: { select: { id: true } } } } },
  });
  if (!year) return;
  const releasable = year.periods.filter((p) => p.enrollments.length === 0).map((p) => p.id);
  await prisma.academicPeriod.deleteMany({ where: { id: { in: releasable } } });
  // Only once nothing is left inside it.
  await prisma.academicYear.deleteMany({
    where: { id: fixtureYearId, periods: { none: {} } },
  });
  fixtureYearId = null;
  nextSequence = 1;
}

import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * **Fixtures from a run that never finished, swept by the next run that starts.**
 *
 * ## The defect this exists for
 *
 * Eight integration suites own their rows with a **run-unique** tag —
 * `` `[content-test:${randomUUID()}]` `` — and each deletes by exactly that
 * string. The comment beside one of them states the reason, and it is a good
 * one: *"a new process must never treat residue from an interrupted older
 * process as its fixture and delete it from the ambient DB"*, because two
 * suites running at once would otherwise delete each other's data mid-test.
 *
 * The cost was never written down. A run that dies before its `afterAll` —
 * killed, out of memory, a failed `beforeAll`, a spend limit — leaves rows whose
 * tag **no future run can ever reproduce**. They are unreachable by design, and
 * they accumulate. Four abandoned `[content-test:…]` runs from a single minute
 * on 2026-09-02 put four fake Categories, Levels and Subjects into the **real
 * Level selector** of «اختبار جديد», where the Document Owner found them while
 * creating an actual exam.
 *
 * That is the platform's own recorded trap in a new shape: *a tag in a mutable
 * column is not a handle*, and now — *a tag no later run can reproduce is not a
 * handle either*.
 *
 * ## Why age is the safe discriminator
 *
 * The original concern is entirely about **concurrency**: two live runs must not
 * collide. Age answers it without giving that up. A row older than
 * `ABANDONED_AFTER_MS` cannot belong to a run that is still going — no
 * integration suite in this repository takes hours — so sweeping only aged rows
 * keeps the isolation the run-unique tag was bought for and drops the
 * accumulation it was paying for.
 *
 * It is deliberately **not** a `TRUNCATE`, not a name-shaped guess, and not
 * scoped by date alone: the prefix identifies the owning suite, and the age
 * identifies abandonment. Both must hold.
 *
 * ## What it does not do
 *
 * It deletes only rows that are already free — anything a foreign key still
 * holds is **left standing and reported**, never force-deleted. A blocked row
 * means the residue is entangled with something, and that is a fact to look at
 * rather than to cascade through.
 */
export const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;

export interface SweepReport {
  deleted: number;
  blocked: number;
}

/**
 * Sweeps abandoned rows carrying `prefix` (e.g. `'[content-test:'`).
 *
 * Ordered child-first so the ordinary case needs no retry, and every delete is
 * individually guarded: one blocked row must not abandon the rest of the sweep.
 */
export async function sweepAbandonedFixtures(
  prisma: PrismaClient,
  prefix: string,
  olderThanMs: number = ABANDONED_AFTER_MS,
): Promise<SweepReport> {
  const before = new Date(Date.now() - olderThanMs);
  const aged = { createdAt: { lt: before } };
  let deleted = 0;
  let blocked = 0;

  const attempt = async (run: () => Promise<{ count: number }>): Promise<void> => {
    try {
      deleted += (await run()).count;
    } catch {
      // Held by a foreign key. Counted and left alone — see the docstring.
      blocked += 1;
    }
  };

  const named = { name: { startsWith: prefix }, ...aged };
  const person = { nameArabic: { startsWith: prefix }, ...aged };

  /**
   * **The teaching a fixture set up, before the Level it hangs off.**
   *
   * `[r82-test:…]` left two `RecurringCourseSchedule` rows holding their Level
   * under RESTRICT, so the Level survived a sweep that only knew about
   * enrolments and groups — and a held Level is a Level still in the selector.
   * Matched by the schedule's own tag OR its Level's, because a suite may tag
   * either, and materialization then writes occurrences that carry neither.
   */
  const owned = {
    OR: [{ title: { startsWith: prefix } }, { level: { name: { startsWith: prefix } } }],
  };
  await attempt(() =>
    prisma.notification.deleteMany({ where: { session: { schedule: owned } } }),
  );
  await attempt(() => prisma.attendance.deleteMany({ where: { session: { schedule: owned } } }));
  await attempt(() => prisma.sessionStaff.deleteMany({ where: { session: { schedule: owned } } }));
  await attempt(() =>
    prisma.sessionContent.deleteMany({ where: { session: { schedule: owned } } }),
  );
  await attempt(() => prisma.session.deleteMany({ where: { schedule: owned } }));
  await attempt(() => prisma.courseScheduleStaff.deleteMany({ where: { schedule: owned } }));
  await attempt(() => prisma.recurringCourseSchedule.deleteMany({ where: owned }));

  // Child rows first, so the parents below are free in the ordinary case.
  await attempt(() =>
    prisma.levelSubject.deleteMany({ where: { level: { name: { startsWith: prefix } } } }),
  );
  await attempt(() =>
    prisma.teachingGroup.deleteMany({ where: { level: { name: { startsWith: prefix } } } }),
  );
  await attempt(() =>
    prisma.administrativeGroup.deleteMany({ where: { level: { name: { startsWith: prefix } } } }),
  );
  await attempt(() =>
    prisma.enrollment.deleteMany({ where: { level: { name: { startsWith: prefix } } } }),
  );
  await attempt(() =>
    prisma.userBranchRole.deleteMany({ where: { user: { nameArabic: { startsWith: prefix } } } }),
  );
  await attempt(() =>
    prisma.userIdentity.deleteMany({ where: { user: { nameArabic: { startsWith: prefix } } } }),
  );
  await attempt(() =>
    prisma.notification.deleteMany({ where: { user: { nameArabic: { startsWith: prefix } } } }),
  );

  // A Room holds its Branch under RESTRICT — the last thing keeping a
  // `[r82-test:…]` branch alive after everything else had gone.
  await attempt(() =>
    prisma.room.deleteMany({ where: { branch: { name: { startsWith: prefix } } } }),
  );
  await attempt(() => prisma.user.deleteMany({ where: person }));
  await attempt(() => prisma.level.deleteMany({ where: named }));
  await attempt(() => prisma.subject.deleteMany({ where: named }));
  await attempt(() => prisma.category.deleteMany({ where: named }));
  await attempt(() => prisma.branch.deleteMany({ where: named }));

  return { deleted, blocked };
}

/**
 * Every prefix in this repository that owns rows under a **run-unique** tag.
 *
 * Listed once so the guard and the suites cannot disagree about the set; adding
 * a suite means adding its prefix here, and the guard then covers it.
 */
export const RUN_UNIQUE_FIXTURE_PREFIXES = [
  '[content-test:',
  '[platform-owner-seed:',
  '[preprov-test:',
  '[platform-owner-http:',
  '[http-usermgmt-test:',
  '[r88-profile-test:',
  '[http-notification-test:',
  '[r82-test:',
] as const;

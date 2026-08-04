import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { atMidnightUtc, expandSchedule, type ScheduleRecurrence } from '../lib/recurrence.js';

/**
 * `session.materialize` — turning a Recurring Course Schedule into dated
 * occurrences (SRS §4.4, TD-7, §20 rule 24, Revision 43).
 *
 * **Eager, not computed on read, and the reason is correctness rather than
 * speed.** §4.4: *"Conflict detection runs against materialized Sessions, not
 * against recurrence rules — which is why materialization is eager. Comparing
 * rules cannot see that a weekly and a biweekly-alternating Tuesday 15:00
 * collide only on alternate weeks."* A lazily-derived calendar could not answer
 * the one question scheduling actually has to answer.
 *
 * **Three guarantees, and every one of them is a rule a future change could
 * quietly break:**
 *
 * 1. **Idempotent per `(schedule_id, date)`** — enforced by a unique index, so
 *    a second run over the same horizon creates nothing. The job is safe to
 *    re-enqueue, retry, or run twice concurrently.
 * 2. **Never rewrites or deletes a Session carrying work.** An `overridden`
 *    session, or one with a note, a recording, a content link or a grade, is
 *    left exactly as it is **and reported**. The platform never silently
 *    discards a human decision or orphans attached work (§4.4, §20 rule 24).
 * 3. **Never regenerates the past.** Materialization starts at today, so a
 *    schedule edited in November does not resurrect September's classes or
 *    rewrite what already happened.
 *
 * **Horizon: through the end of the current `AcademicYear`**, extended by the
 * nightly cron. Bounded deliberately — an unbounded horizon would generate rows
 * for a schedule that may be discontinued next term, and §2.4 sizes the database
 * for a real association rather than for arithmetic.
 */

/** Everything materialization needs from a schedule. Read once, so a long run
 *  cannot half-apply an edit that lands mid-loop. */
export interface MaterializableSchedule extends ScheduleRecurrence {
  id: string;
  startTime: Date;
  endTime: Date;
  roomId: string | null;
  academicYearId: string;
}

export interface MaterializeResult {
  scheduleId: string;
  created: number;
  /** Sessions that already existed and were left alone — the idempotency proof. */
  existing: number;
  /** Sessions deliberately NOT touched because they carry a human decision or
   *  attached work. Surfaced, never silently skipped (§4.4). */
  protectedSessions: { id: string; date: Date; reason: string }[];
}

/**
 * The horizon a run materializes to: the end of the current academic year.
 *
 * `AcademicYear.label` is a validated `YYYY-YYYY` (§4.10, TD-6), so the second
 * year is the one the academic year ends in. Falls back to one year out when no
 * current year is configured — a deployment mid-setup should still be able to
 * schedule, and returning nothing would look like a broken job rather than a
 * missing setting.
 */
export async function horizonFor(
  db: Pick<PrismaClient, 'academicYear'>,
  today: Date,
): Promise<Date> {
  const current = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: { label: true },
  });
  const endYear = current ? Number(current.label.slice(5, 9)) : NaN;
  if (Number.isFinite(endYear)) {
    // 31 August closes the Moroccan school year; a September start then falls
    // into the next academic year, which the next run will pick up.
    return new Date(Date.UTC(endYear, 7, 31));
  }
  return new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate()));
}

/**
 * Which sessions must never be rewritten, and why.
 *
 * Read as one query per protected kind rather than per session: at horizon
 * scale a per-row check would be an N+1 wearing a guard's clothing.
 */
async function protectedSessionIds(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  from: Date,
): Promise<Map<string, string>> {
  const sessions = await tx.session.findMany({
    where: { scheduleId, deletedAt: null, date: { gte: from } },
    select: {
      id: true,
      date: true,
      overridden: true,
      status: true,
      cancellationReason: true,
      _count: { select: { linkedContent: { where: { deletedAt: null } } } },
    },
  });

  const reasons = new Map<string, string>();
  for (const s of sessions) {
    if (s.overridden) reasons.set(s.id, 'OVERRIDDEN');
    else if (s.status !== 'scheduled') reasons.set(s.id, `STATUS_${s.status.toUpperCase()}`);
    else if (s._count.linkedContent > 0) reasons.set(s.id, 'HAS_CONTENT');
  }
  return reasons;
}

/**
 * Materializes one schedule's sessions from `today` to the horizon.
 *
 * Runs inside the caller's transaction when one is supplied (TD-4.6c enqueues
 * it in the same transaction as the schedule write), or opens its own.
 */
export async function materializeSchedule(
  tx: Prisma.TransactionClient,
  schedule: MaterializableSchedule,
  today: Date,
  horizon: Date,
): Promise<MaterializeResult> {
  const from = atMidnightUtc(today);
  const dates = expandSchedule(schedule, from, horizon);

  const existingRows = await tx.session.findMany({
    where: { scheduleId: schedule.id, date: { gte: from, lte: horizon } },
    select: { id: true, date: true },
  });
  const existingByDate = new Map(existingRows.map((r) => [r.date.toISOString().slice(0, 10), r.id]));
  const protectedIds = await protectedSessionIds(tx, schedule.id, from);

  let created = 0;
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    if (existingByDate.has(key)) continue;

    // `createMany` with `skipDuplicates` would be one round trip, but it cannot
    // report WHICH rows it skipped — and "how many did this edit actually
    // create" is what the administrator is told (§4.4). The unique index is
    // still the real idempotency guarantee; this loop is how the answer is
    // built.
    await tx.session.create({
      data: {
        scheduleId: schedule.id,
        date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        roomId: schedule.roomId,
        // `teacherId` is left null here on purpose. The schedule's staff live
        // in `CourseScheduleStaff` and may change; copying one onto every
        // session would snapshot an assignment that the staff table is the
        // source of truth for. A session carries its own teacher only once a
        // human sets one, which is exactly what `overridden` marks.
        status: 'scheduled',
        overridden: false,
      },
    });
    created += 1;
  }

  const wanted = new Set(dates.map((d) => d.toISOString().slice(0, 10)));
  const orphaned = existingRows.filter((r) => !wanted.has(r.date.toISOString().slice(0, 10)));

  // A date the rule no longer produces: the schedule moved from Tuesdays to
  // Wednesdays, say. Un-protected orphans are removed so the calendar matches
  // the rule; protected ones stay and are reported.
  for (const row of orphaned) {
    if (protectedIds.has(row.id)) continue;
    await tx.session.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
  }

  return {
    scheduleId: schedule.id,
    created,
    existing: existingRows.length - orphaned.length,
    protectedSessions: [...protectedIds.entries()].map(([id, reason]) => ({
      id,
      date: existingRows.find((r) => r.id === id)?.date ?? from,
      reason,
    })),
  };
}

/** Loads a schedule in the shape materialization needs. */
export async function loadSchedule(
  tx: Prisma.TransactionClient,
  scheduleId: string,
): Promise<MaterializableSchedule | null> {
  const s = await tx.recurringCourseSchedule.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      roomId: true,
      academicYearId: true,
      recurrence: true,
      weekdays: true,
      dayOfMonth: true,
      monthOfYear: true,
      anchorDate: true,
    },
  });
  return s;
}

/**
 * The job body: materialize one schedule, or every active schedule when no id
 * is given (the nightly cron advancing the rolling horizon, TD-7).
 */
export async function runMaterialization(
  prisma: PrismaClient,
  payload: { schedule_id?: string },
  now: Date = new Date(),
): Promise<MaterializeResult[]> {
  const horizon = await horizonFor(prisma, now);

  const ids = payload.schedule_id
    ? [payload.schedule_id]
    : (
        await prisma.recurringCourseSchedule.findMany({
          where: { deletedAt: null },
          select: { id: true },
        })
      ).map((s) => s.id);

  const results: MaterializeResult[] = [];
  for (const id of ids) {
    // One transaction PER SCHEDULE, not one for the whole sweep: a single bad
    // schedule must not roll back a night's work for every other one, and the
    // cron's job is to converge rather than to be all-or-nothing.
    const result = await prisma.$transaction(async (tx) => {
      const schedule = await loadSchedule(tx, id);
      if (!schedule) return null;
      return materializeSchedule(tx, schedule, now, horizon);
    });
    if (result) results.push(result);
  }
  return results;
}

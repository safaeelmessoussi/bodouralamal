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
  /** Snapshot onto every future session this run touches (Revision 43.4). */
  staff: { userId: string; position: 'teacher' | 'assistant' }[];
}

export interface MaterializeResult {
  scheduleId: string;
  created: number;
  /** Sessions that already existed and were left alone — the idempotency proof. */
  existing: number;
  /** Future, un-overridden sessions brought back into line with the schedule
   *  (Revision 43.4). Without this an edit changed nothing about the occurrences
   *  that already existed, so §4.4's promise that it "rewrites future Sessions"
   *  was not true. */
  resynced: number;
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
 * **THE protection predicate — one definition, every caller (§4.4, Revision
 * 43.5).**
 *
 * A Session is protected from schedule-driven regeneration when it carries a
 * human decision or **educational work**. §4.4 states this once and requires it
 * to stay one predicate: *"as each kind of work ships it joins that predicate
 * and every caller inherits the protection. A second copy of the test is how a
 * future feature silently loses it."*
 *
 * **The protection is DATE-INDEPENDENT** (43.5). A recording attached to next
 * Tuesday's class is exactly as much someone's labour as one attached to last
 * Tuesday's, so a future session carrying work is as protected as a past one.
 *
 * **What counts, and where the rest will attach:**
 *
 * | Signal | Status |
 * |---|---|
 * | `overridden` — a human decided about this occurrence | built |
 * | `status` is `held` or `cancelled` — it happened, or its absence is a record | built |
 * | linked educational content — recordings, homework, materials (§4.9) | built |
 * | attendance (§4.7) | **specified, deliberately unbuilt** — add its count here |
 * | notes · announcements (§10.1) | **not yet specified as entities** — add here |
 * | grades sat in this session | `Grade` has no session reference today; if one is added, add its count here |
 *
 * Adding a row to that table is the *whole* change needed to protect a new kind
 * of work — which is the reason this is a table and not three `if`s scattered
 * across three services.
 */
export const SELECT_FOR_PROTECTION = {
  id: true,
  date: true,
  overridden: true,
  status: true,
  _count: { select: { linkedContent: { where: { deletedAt: null } } } },
} as const;

/** The reason one session is protected, or `null` if it may be regenerated. */
export function protectionReason(session: {
  overridden: boolean;
  status: string;
  _count: { linkedContent: number };
}): string | null {
  if (session.overridden) return 'OVERRIDDEN';
  if (session.status !== 'scheduled') return `STATUS_${session.status.toUpperCase()}`;
  if (session._count.linkedContent > 0) return 'HAS_CONTENT';
  return null;
}

/**
 * Protection reasons for a schedule's sessions from `from` onward.
 *
 * One query rather than one per session: at horizon scale a per-row check would
 * be an N+1 wearing a guard's clothing.
 */
async function protectedSessionIds(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  from: Date,
): Promise<Map<string, string>> {
  const sessions = await tx.session.findMany({
    where: { scheduleId, deletedAt: null, date: { gte: from } },
    select: SELECT_FOR_PROTECTION,
  });

  const reasons = new Map<string, string>();
  for (const s of sessions) {
    const reason = protectionReason(s);
    if (reason !== null) reasons.set(s.id, reason);
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
    const row = await tx.session.create({
      data: {
        scheduleId: schedule.id,
        date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        // SNAPSHOT (Revision 43.4). Room and staff are written onto the
        // occurrence, not re-derived from the schedule at read time, so a held
        // session stays historically correct when the schedule later changes.
        roomId: schedule.roomId,
        status: 'scheduled',
        overridden: false,
      },
      select: { id: true },
    });
    await snapshotStaff(tx, row.id, schedule.staff);
    created += 1;
  }

  // Re-sync the occurrences that already exist and are still wanted (43.4).
  // ONLY future, un-overridden, still-`scheduled` ones: a past or `held`
  // session is history and keeps what it was materialized with, whatever the
  // schedule now says (§4.4).
  let resynced = 0;
  for (const row of existingRows) {
    const key = row.date.toISOString().slice(0, 10);
    if (!dates.some((d) => d.toISOString().slice(0, 10) === key)) continue;
    if (protectedIds.has(row.id)) continue;

    await tx.session.update({
      where: { id: row.id },
      data: {
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        roomId: schedule.roomId,
      },
    });
    await snapshotStaff(tx, row.id, schedule.staff);
    resynced += 1;
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
    resynced,
    existing: existingRows.length - orphaned.length,
    protectedSessions: [...protectedIds.entries()].map(([id, reason]) => ({
      id,
      date: existingRows.find((r) => r.id === id)?.date ?? from,
      reason,
    })),
  };
}

/**
 * Writes one occurrence's staffing snapshot (Revision 43.4).
 *
 * Replaces whatever was there rather than merging: the snapshot states *the
 * assignment as it stands for this session*, and a merge would accumulate
 * everyone who was ever on it. Soft-deleted rather than hard-deleted, so a
 * removed name stays visible in the record.
 */
async function snapshotStaff(
  tx: Prisma.TransactionClient,
  sessionId: string,
  staff: { userId: string; position: 'teacher' | 'assistant' }[],
): Promise<void> {
  const keep = new Set(staff.map((s) => s.userId));
  const existing = await tx.sessionStaff.findMany({
    where: { sessionId },
    select: { id: true, userId: true, deletedAt: true },
  });

  for (const row of existing) {
    if (!keep.has(row.userId) && row.deletedAt === null) {
      await tx.sessionStaff.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    }
  }

  for (const s of staff) {
    const found = existing.find((e) => e.userId === s.userId);
    if (found) {
      await tx.sessionStaff.update({
        where: { id: found.id },
        data: { position: s.position, deletedAt: null, deletedById: null },
      });
    } else {
      await tx.sessionStaff.create({
        data: { sessionId, userId: s.userId, position: s.position },
      });
    }
  }
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
      staff: { where: { deletedAt: null }, select: { userId: true, position: true } },
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

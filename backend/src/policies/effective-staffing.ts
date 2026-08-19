import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

/**
 * **Effective-dated teaching staffing — the one place a date meets an
 * assignment** (SRS §4.4c as revised by R91).
 *
 * Before R91 a `CourseScheduleStaff` row said *she staffs this schedule*, with
 * no period. Every consumer read it as though it had always been true and
 * always would be, so the platform could not answer *who teaches this class in
 * November* — and a replacement could only be expressed by editing every
 * occurrence by hand or by destroying the record of who taught before.
 *
 * ## The model, stated once
 *
 * An assignment carries two **inclusive calendar dates** (TD-11 — never
 * instants; a replacement runs *from the 1st to the 30th* at each branch's own
 * clock). **`NULL` is open-ended at that end:**
 *
 * | | Meaning |
 * |---|---|
 * | `effective_from = NULL` | from the schedule's own beginning |
 * | `effective_until = NULL` | through the schedule's own end (itself possibly open) |
 *
 * That reading is what makes the migration a no-op: a row written before R91
 * has both NULL, which spans the schedule's whole life — exactly what a
 * time-blind row already meant. **Nothing was backfilled**, because deriving an
 * `effective_from` from `anchor_date` would assert an assignment date nobody
 * recorded.
 *
 * ## What this module is for
 *
 * §8 of the Owner's brief, in one sentence: *do not let calendar, Quran, exams,
 * notifications and roster each reimplement date comparisons.* Every arm of
 * teaching authority composes `effectiveOn` below; there is no second date
 * predicate anywhere in the codebase, and a guard asserts it.
 *
 * ## What it is NOT
 *
 * **It is not the truth about a past occurrence.** A Session carries its own
 * staffing snapshot (`SessionStaff`, R43.4) written when it was materialized,
 * and *that* is who actually delivered it. Resolving a historical Session
 * through the schedule would let a staffing change rewrite history, which R91
 * forbids in terms. The rule is: **schedule staffing answers "who is assigned
 * for this period"; SessionStaff answers "who took this class".**
 */

/** The platform's calendar day for staffing arithmetic — UTC-midnight-anchored,
 *  matching how every `@db.Date` column in this schema is written and read. */
export function calendarDay(at: Date = new Date()): Date {
  const d = new Date(at);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * **Is this assignment in force on this date?** — as a Prisma fragment, so it
 * composes into the caller's single query rather than materialising ids.
 *
 * The reasoning `roster-resolution` records applies unchanged: a list of ids is
 * a snapshot, and between resolving it and using it the answer can change.
 *
 * Both bounds are inclusive, and `NULL` passes at that end.
 */
export function effectiveOn(on: Date): Prisma.CourseScheduleStaffWhereInput {
  const day = calendarDay(on);
  return {
    deletedAt: null,
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: day } }] },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: day } }] },
    ],
  };
}

/**
 * **Does this assignment touch this date RANGE at all?**
 *
 * The range form, for callers asking about a period rather than an instant — a
 * teacher's calendar month, or R90's appraisal of a class that recurs. Two
 * closed intervals with open ends intersect unless one ends before the other
 * begins.
 *
 * `to` is inclusive, like every other date in this module: a range is *these
 * days*, not *up to but not including*.
 */
export function effectiveWithin(
  from: Date,
  to: Date,
): Prisma.CourseScheduleStaffWhereInput {
  const start = calendarDay(from);
  const end = calendarDay(to);
  return {
    deletedAt: null,
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: end } }] },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: start } }] },
    ],
  };
}

/** The same predicate spelled for a nested `staff: { some: … }` on a schedule. */
export function staffedOn(
  userId: string,
  on: Date,
): Prisma.CourseScheduleStaffWhereInput {
  return { userId, ...effectiveOn(on) };
}

export interface EffectiveAssignment {
  id: string;
  userId: string;
  position: "teacher" | "assistant";
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
}

/**
 * **`staffForScheduleOn(scheduleId, date)`** — §8's named resolver.
 *
 * The main مؤطِّرة in force on that date, and every assistant in force on it.
 * `main` is `null` when the schedule has nobody assigned then, which is a real
 * state: a series may begin before its teacher's period does.
 *
 * **At most one main is an invariant, not an assumption** — enforced in the
 * service under a row lock — but this returns the first by `effectiveFrom` so a
 * database that somehow held two would produce a stable answer rather than an
 * arbitrary one.
 */
export async function staffForScheduleOn(
  prisma: Prisma.TransactionClient | PrismaClient,
  scheduleId: string,
  on: Date,
): Promise<{
  main: EffectiveAssignment | null;
  assistants: EffectiveAssignment[];
}> {
  const rows = await prisma.courseScheduleStaff.findMany({
    where: { scheduleId, ...effectiveOn(on) },
    select: {
      id: true,
      userId: true,
      position: true,
      effectiveFrom: true,
      effectiveUntil: true,
    },
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
  });
  const typed = rows as EffectiveAssignment[];
  return {
    main: typed.find((r) => r.position === "teacher") ?? null,
    assistants: typed.filter((r) => r.position === "assistant"),
  };
}

/**
 * **`effectiveSchedulesForTeacher(userId, on)`** — §8's other named resolver.
 *
 * The schedules this person is assigned to on that date, main or assistant
 * alike. **Position is not consulted**, and that is R87 §G rather than an
 * oversight: an assistant IS the main teacher for operational authorization on
 * the class she staffs, and `position` records responsibility and audit.
 */
export async function effectiveSchedulesForTeacher(
  prisma: PrismaClient,
  userId: string,
  on: Date,
): Promise<string[]> {
  const rows = await prisma.courseScheduleStaff.findMany({
    where: { userId, ...effectiveOn(on), schedule: { deletedAt: null } },
    select: { scheduleId: true },
  });
  return [...new Set(rows.map((r) => r.scheduleId))];
}

/* ── interval invariants ─────────────────────────────────────────────────── */

export interface Interval {
  from: Date | null;
  until: Date | null;
}

/**
 * Do two open-ended inclusive intervals overlap?
 *
 * Pure, so the boundary cases are testable exhaustively without a database:
 * touching at a single day **is** an overlap here, unlike
 * `teaching-profile.overlaps` for availability ranges. The difference is real
 * and deliberate — two availability ranges that touch describe one continuous
 * free period, while two assignments that share a day mean two people are the
 * main teacher on that day, which is exactly what §6 forbids.
 */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  const aFrom = a.from?.getTime() ?? -Infinity;
  const aUntil = a.until?.getTime() ?? Infinity;
  const bFrom = b.from?.getTime() ?? -Infinity;
  const bUntil = b.until?.getTime() ?? Infinity;
  return aFrom <= bUntil && bFrom <= aUntil;
}

/**
 * **Does this assignment fall inside the schedule's own life?** (§5)
 *
 * A schedule begins at its `anchorDate` — when it has one; `daily`, `monthly`
 * and `yearly` recurrences do not — and ends at its `effectiveUntil`, R50's
 * series bound, which is `NULL` for an open-ended series.
 *
 * **Refusal, not clipping** (§5's stated preference): silently rewriting a date
 * an administrator typed would leave her believing she recorded something she
 * did not, and the boundary she got wrong is exactly the one she needs told.
 */
export function withinScheduleLife(
  assignment: Interval,
  schedule: { anchorDate: Date | null; effectiveUntil: Date | null },
): boolean {
  return intervalsOverlap(assignment, {
    from: schedule.anchorDate,
    until: schedule.effectiveUntil,
  });
}

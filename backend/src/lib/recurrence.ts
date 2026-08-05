/**
 * Recurrence expansion — **one implementation, two consumers** (SRS §4.4,
 * Revision 43).
 *
 * §4.4 states it directly: *"Recurrence is a single shared value object used by
 * both `RecurringCourseSchedule` and `Event`; it is **not** modelled twice …
 * the alternating-week arithmetic is exactly the code nobody wants written in
 * two places."* This module is that one place. `expandEvent` and `expandGroup`
 * lived in `calendar.service.ts`; they moved here so the schedule side could
 * reuse them instead of growing a parallel copy.
 *
 * **Every branch is integer day arithmetic on UTC-midnight dates, and that is
 * the whole DST defence** (TD-11, §20 rule 14). No local-time conversion ever
 * happens here, so Morocco's Ramadan DST suspension cannot move an occurrence to
 * a different day. A date is a *calendar date*, never an instant.
 *
 * **Two anchoring shapes, deliberately not merged:**
 *
 * - **Anchored** (`Event`) — a start date plus a type. The event happens on that
 *   date and then every N days.
 * - **Weekday-set** (`RecurringCourseSchedule`) — a set of weekdays plus, for
 *   the alternating pattern, an anchor week. A class happens *on Tuesdays*, not
 *   *every 14 days from the 3rd*.
 *
 * Collapsing them would mean one of the two lying about how it is specified.
 * They share the primitives and the range clamping, which is where the real
 * duplication risk lives.
 */

export const MS_PER_DAY = 86_400_000;

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * MS_PER_DAY);

/** `Date.getUTCDay()` is Sunday-0; the platform's week starts Monday (BR-17),
 *  but the INDEX here is the JS one — Monday-first ordering is a rendering
 *  concern, not an arithmetic one, and conflating them is a classic off-by-one. */
export const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Midnight UTC on the same calendar day — the canonical form every function
 *  here works in, so two dates from different sources compare correctly. */
export const atMidnightUtc = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Whole days between two calendar dates. Exact because both sides are
 *  UTC-midnight, so no partial day can round the answer. */
export const daysBetween = (a: Date, b: Date): number =>
  Math.round((atMidnightUtc(b).getTime() - atMidnightUtc(a).getTime()) / MS_PER_DAY);

/**
 * Expands one **anchored** recurrence — the `Event` shape.
 *
 * Moved verbatim from `calendar.service.ts`, which re-exports it so existing
 * callers and their tests are unaffected.
 */
export function expandEvent(
  event: {
    startDate: Date;
    endDate: Date | null;
    recurrenceType: string;
    recurrenceEndDate: Date | null;
  },
  from: Date,
  to: Date,
): Date[] {
  const last =
    event.recurrenceEndDate && event.recurrenceEndDate < to ? event.recurrenceEndDate : to;
  if (event.startDate > last) return [];

  const out: Date[] = [];
  const push = (d: Date): void => {
    if (d >= from && d <= last) out.push(d);
  };

  switch (event.recurrenceType) {
    case 'none': {
      // A multi-day one-off occupies every day of its span.
      const end = event.endDate ?? event.startDate;
      for (let d = event.startDate; d <= end; d = addDays(d, 1)) push(d);
      break;
    }
    case 'daily':
      for (let d = event.startDate; d <= last; d = addDays(d, 1)) push(d);
      break;
    case 'weekly':
      for (let d = event.startDate; d <= last; d = addDays(d, 7)) push(d);
      break;
    case 'biweekly_alternating':
      // §4.4's "week on / week off": every fourteenth day from the start.
      for (let d = event.startDate; d <= last; d = addDays(d, 14)) push(d);
      break;
    case 'yearly': {
      const startYear = event.startDate.getUTCFullYear();
      for (let year = startYear; ; year += 1) {
        const d = new Date(
          Date.UTC(year, event.startDate.getUTCMonth(), event.startDate.getUTCDate()),
        );
        if (d > last) break;
        push(d);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Expands a single weekday across a range — the retiring `Group` shape. */
export function expandGroup(dayOfWeek: string, from: Date, to: Date): Date[] {
  const target = DAY_INDEX[dayOfWeek];
  if (target === undefined) return [];

  const out: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d.getUTCDay() === target) out.push(d);
  }
  return out;
}

/** The recurrence half of a `RecurringCourseSchedule` (§7). */
export interface ScheduleRecurrence {
  recurrence: string;
  /** Used by `weekly` (exactly one), `multiple_weekdays`, `biweekly_alternating`. */
  weekdays: string[];
  /** Used by `monthly` and `yearly`. */
  dayOfMonth: number | null;
  /** Used by `yearly`. */
  monthOfYear: number | null;
  /**
   * Which week `biweekly_alternating` counts from. Without it "week on" and
   * "week off" are indistinguishable — the two halves of the alternation are
   * the same shape, so something has to say which one is which. The database
   * requires it for that pattern (`course_schedule_recurrence_shape_check`).
   */
  anchorDate: Date | null;
  /**
   * The last date this recurrence produces occurrences for (SRS Revision 50).
   *
   * **`null` is open-ended.** It bounds a series together with `anchorDate`, and
   * is what makes a schedule SPLIT expressible: the closed half stops here, the
   * successor is anchored at the next day.
   *
   * **Optional on this type deliberately.** Callers that predate R50 — the
   * conflict preview, the roster resolver — pass rules they build themselves,
   * and an omitted bound must mean *unbounded* rather than *stops today*.
   */
  effectiveUntil?: Date | null;
}

/**
 * Expands a **weekday-set** recurrence — the `RecurringCourseSchedule` shape.
 *
 * **`biweekly_alternating` is the case everything else exists to get right.**
 * A class on alternating Tuesdays collides with a weekly Tuesday class only on
 * *its* weeks, and comparing recurrence *rules* cannot see that — which is the
 * stated reason §4.4 materializes sessions eagerly instead of computing them on
 * read. The parity is measured in **whole weeks from the anchor's Monday**, not
 * in days from the anchor: anchoring on the day would make a Tuesday-and-Friday
 * alternating schedule flip parity mid-week.
 *
 * `none` never appears here — the database refuses it on a schedule
 * (`course_schedule_recurrence_not_none_check`), because a non-recurring
 * occurrence is an Event.
 */
export function expandSchedule(rule: ScheduleRecurrence, from: Date, to: Date): Date[] {
  const start = atMidnightUtc(from);
  // **R50: `effective_until` is a SECOND upper bound and the earlier one wins.**
  // The caller's horizon is the academic year's end (`horizonFor`); this is
  // where the series itself stops. Applying it HERE and nowhere else is the
  // whole point — this function is the single place a rule becomes dates, and
  // a second expansion applying its own bound would eventually disagree with
  // this one.
  const ruleEnd = rule.effectiveUntil ? atMidnightUtc(rule.effectiveUntil) : null;
  const requested = atMidnightUtc(to);
  const end = ruleEnd !== null && ruleEnd < requested ? ruleEnd : requested;
  if (start > end) return [];

  const wanted = new Set(
    rule.weekdays.map((d) => DAY_INDEX[d]).filter((n): n is number => n !== undefined),
  );

  const out: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (matches(rule, d, wanted)) out.push(d);
  }
  return out;
}

function matches(rule: ScheduleRecurrence, d: Date, wanted: Set<number>): boolean {
  switch (rule.recurrence) {
    case 'daily':
      return true;

    case 'weekly':
    case 'multiple_weekdays':
      return wanted.has(d.getUTCDay());

    case 'biweekly_alternating': {
      if (!wanted.has(d.getUTCDay())) return false;
      if (rule.anchorDate === null) return false;
      // Weeks, not days: a schedule running Tuesday AND Friday must keep both
      // days on the same side of the alternation, and day-parity would split
      // them across the mid-week boundary.
      const weeks = Math.floor(daysBetween(mondayOf(rule.anchorDate), mondayOf(d)) / 7);
      return weeks % 2 === 0;
    }

    case 'monthly':
      return rule.dayOfMonth !== null && d.getUTCDate() === rule.dayOfMonth;

    case 'yearly':
      return (
        rule.dayOfMonth !== null &&
        rule.monthOfYear !== null &&
        d.getUTCDate() === rule.dayOfMonth &&
        d.getUTCMonth() + 1 === rule.monthOfYear
      );

    default:
      // Includes `none`, which the database refuses on a schedule. Returning
      // false rather than throwing: an unexpanded schedule generates no
      // sessions, which is visible and harmless, where a throw would fail a
      // whole materialization run over one bad row.
      return false;
  }
}

/** The Monday on or before `d` — the platform's week start (BR-17). */
export function mondayOf(d: Date): Date {
  const day = atMidnightUtc(d);
  // getUTCDay is Sunday-0, so Sunday is 6 days after its Monday, not 0.
  const offset = (day.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

/**
 * Whether two half-open time ranges on the same date overlap.
 *
 * **Half-open**: a class ending at 10:00 does not conflict with one starting at
 * 10:00. Treating the boundary as a collision would make back-to-back classes in
 * one room impossible, which is how the association actually uses its rooms.
 */
export function timesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  const t = (d: Date): number =>
    d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return t(aStart) < t(bEnd) && t(bStart) < t(aEnd);
}

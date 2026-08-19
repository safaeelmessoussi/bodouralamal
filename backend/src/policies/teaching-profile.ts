/**
 * **The teaching profile's arithmetic** (§E, R88).
 *
 * Planning helpers, and the word *planning* is load-bearing: nothing here
 * decides what anybody may do. A mismatch produces a **warning the
 * administration may override**, because the association resolves exceptional
 * cases outside the system and a platform that refused them would be refusing
 * the association's own judgement.
 *
 * Pure functions over plain minutes, so the rules can be tested exhaustively
 * without a database and without a clock.
 */

/** `HH:MM` → minutes since midnight. Wall-clock (TD-11), never an instant. */
export function minutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export interface Range {
  weekday: string;
  start: string;
  end: string;
}

/**
 * **Is the proposed class entirely inside ONE declared range?**
 *
 * The Owner's rule, and the strictness is the point: 15:30–17:00 fits an
 * availability of 15:00–18:00, and 14:30–16:00 does not — *partly available* is
 * not available, and a planner told "matches" for a class that starts half an
 * hour before she arrives has been told something false.
 *
 * **Ranges are never implicitly merged.** Two declarations of 09:00–12:00 and
 * 12:00–15:00 do not together cover 11:00–13:00: the association wrote two
 * ranges, and reading them as one would invent an availability nobody declared.
 * A person who is free straight through says so with a single 09:00–15:00 range
 * — which the service's overlap rule makes the only way to say it.
 */
export function isWithinAvailability(
  proposed: Range,
  declared: readonly Range[],
): boolean {
  const start = minutes(proposed.start);
  const end = minutes(proposed.end);
  return declared.some(
    (range) =>
      range.weekday === proposed.weekday &&
      minutes(range.start) <= start &&
      minutes(range.end) >= end,
  );
}

/**
 * Do two ranges on one day overlap — or merely touch?
 *
 * **Touching is not overlapping**: 09:00–12:00 and 12:00–15:00 are accepted as
 * two ranges, because a teacher genuinely available across both wrote them that
 * way and refusing would force her to restate her own availability. What is
 * refused is a true overlap, which has two readings and no canonical one.
 */
export function overlaps(a: Range, b: Range): boolean {
  if (a.weekday !== b.weekday) return false;
  return minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

/** The first overlapping pair, or `null` — so a refusal can name what clashed. */
export function firstOverlap(ranges: readonly Range[]): [Range, Range] | null {
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      if (overlaps(ranges[i]!, ranges[j]!)) return [ranges[i]!, ranges[j]!];
    }
  }
  return null;
}

/**
 * **Time overlap, not "she already has work"** (§9).
 *
 * One مؤطِّرة legitimately teaches across several branches, levels and subjects
 * — R87 §F is explicit about it — so holding another assignment is not a
 * conflict. Two classes at the same hour are.
 */
export function conflictsWith(proposed: Range, existing: readonly Range[]): Range[] {
  return existing.filter((range) => overlaps(proposed, range));
}

/**
 * **Which weekdays does a proposed recurrence actually occupy?** (§7)
 *
 * The warnings must be true of the *class*, not of one arbitrary occurrence, so
 * the appraisal asks the recurrence which days it lands on and evaluates every
 * one of them. **No second recurrence engine**: this reads the fields
 * `RecurringCourseSchedule` already stores (§4.4) and computes nothing the
 * materializer does not.
 *
 * `null` means **indeterminate, not empty** — `monthly` and `yearly` recur on a
 * day of the MONTH, which lands on a different weekday almost every time, so
 * *is she available then* has no single answer. Saying "available" would be a
 * guess and saying "unavailable" would be a false accusation; the appraisal says
 * it cannot tell.
 */
export const ALL_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export function occupiedWeekdays(
  recurrence: string,
  weekdays: readonly string[],
): string[] | null {
  switch (recurrence) {
    case 'weekly':
    case 'multiple_weekdays':
    case 'biweekly_alternating':
      return [...weekdays];
    case 'daily':
      return [...ALL_WEEKDAYS];
    default:
      return null;
  }
}

/**
 * **Do two recurrences ever land on the same day?**
 *
 * Sharing a weekday is not enough when one of them alternates. Two
 * `biweekly_alternating` series on the same weekday collide only when their
 * anchors fall in weeks of the **same parity** — otherwise they interleave
 * forever and neither ever meets the other. A weekly series against a
 * fortnightly one collides every other week, which is a collision.
 *
 * Parity comes from `anchor_date`, which §4.4 stores for exactly this reason:
 * *"without an anchor, 'week on' is undefined and the two halves of the
 * alternation are indistinguishable."* An alternating series with no anchor is
 * treated as colliding — the safe direction for a warning, since the cost of an
 * unnecessary warning the administrator overrides is far below the cost of a
 * silent double-booking.
 */
export function seriesCanCoincide(
  a: { recurrence: string; anchorDate: Date | null },
  b: { recurrence: string; anchorDate: Date | null },
): boolean {
  const alternating = (x: { recurrence: string }): boolean =>
    x.recurrence === 'biweekly_alternating';
  if (!alternating(a) || !alternating(b)) return true;
  if (a.anchorDate === null || b.anchorDate === null) return true;
  const week = (d: Date): number => Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
  return (week(a.anchorDate) - week(b.anchorDate)) % 2 === 0;
}

/**
 * **Does this staffing assignment fall inside its schedule's life?** (R91, §5)
 *
 * The client-side half of `withinScheduleLife`
 * (`backend/src/policies/effective-staffing.ts`), which is the authority and
 * stays it. This exists because the server's refusal —
 * `STAFF_PERIOD_OUTSIDE_SCHEDULE` — arrives only on Save, after the
 * administrator has filled in a whole form, and it names no field. The Owner's
 * case was a schedule beginning 30 غشت 2026 with an assignment of
 * 29 غشت → 29 غشت: correct to refuse, and refused far too late to be useful.
 *
 * **The rule is OVERLAP, not containment.** An assignment that starts before
 * the schedule and runs into it is legitimate — it is simply already in force
 * when the class begins. Only a period sharing **no day at all** with the
 * schedule is meaningless, and that is what both sides test.
 *
 * **Why a mirror is acceptable here**, when the platform's rule is one source
 * of truth per concept: this never decides anything. The server refuses
 * independently and its refusal is what is authoritative; if the two ever
 * disagree, the save still fails correctly and the reader is merely warned
 * early. A copy that can only be *early*, never *permissive*, is a hint — and
 * `staffing-period.test.ts` pins it against the same cases the backend policy
 * test uses, so drift is caught rather than discovered.
 *
 * Dates are ISO `YYYY-MM-DD` strings, which compare correctly as strings, and
 * `''` means open at that end.
 */
export interface DateRange {
  from: string;
  until: string;
}

/** Two ranges share at least one day. `''` is unbounded at that end. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const aFrom = a.from === '' ? '-' : a.from;
  const aUntil = a.until === '' ? '~' : a.until;
  const bFrom = b.from === '' ? '-' : b.from;
  const bUntil = b.until === '' ? '~' : b.until;
  // '-' sorts below every digit and '~' above them, so the sentinels behave as
  // −∞ and +∞ under the same string comparison the real dates use.
  return aFrom <= bUntil && bFrom <= aUntil;
}

/**
 * `true` when the assignment shares no day with the schedule — i.e. exactly
 * when the server would answer `STAFF_PERIOD_OUTSIDE_SCHEDULE`.
 *
 * A row with **no dates at all** is open-ended and always overlaps, so an
 * untouched new row is never marked wrong.
 */
export function periodOutsideSchedule(period: DateRange, schedule: DateRange): boolean {
  return !rangesOverlap(period, schedule);
}

/**
 * `true` when a period's own ends are the wrong way round. Separate from the
 * question above because it is a different mistake with a different fix, and
 * saying «outside the schedule» to somebody who typed the two dates backwards
 * sends them to the wrong field.
 */
export function periodEndsBeforeItStarts(period: DateRange): boolean {
  return period.from !== '' && period.until !== '' && period.until < period.from;
}

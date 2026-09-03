/**
 * **Date of birth — one parser, one age derivation, no stored age** (Owner
 * decision, 2026-09-03; SRS Revision 130).
 *
 * ## Why a module rather than a Zod refinement
 *
 * Three boundaries need the same answer — public registration, a child on a
 * family request, and an administrator completing a legacy record — and a
 * fourth will need it when the self-managed-account transition is built. A rule
 * stated four times drifts, and this one has a **safeguarding** consequence: the
 * eighteen-year threshold decides who may hold their own login.
 *
 * ## Why the age is derived and never stored
 *
 * An age column is wrong the day after it is written. The Owner's decision is
 * explicit — store the full date, derive the age — so nothing here persists a
 * number, and `ageOn` takes the reference date as an argument rather than
 * reading the clock, so a caller reasoning about a past occurrence gets the age
 * **then** rather than the age now. That is the same rule R122 applies to
 * enrolment periods: the relevant fact is the one covering the date in question.
 */

/** A TD-11 calendar date: `YYYY-MM-DD`, never an instant. */
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The oldest date accepted, expressed as an age rather than a year so it does
 * not quietly become stricter as time passes.
 *
 * **This is a typo guard, not an eligibility rule.** `1092-05-03` is a slipped
 * digit and `2126-05-03` is another; neither is a person. Nothing in the
 * platform refuses anybody for being old, and §20 forbids inventing an
 * eligibility cutoff that no requirement states.
 */
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

/** The age at which a person may hold their own login (Owner, 2026-09-03). */
export const SELF_MANAGED_AGE_YEARS = 18;

export type BirthDateProblem = 'SHAPE' | 'NOT_A_REAL_DATE' | 'IN_THE_FUTURE' | 'IMPLAUSIBLY_OLD';

/**
 * Parses and validates a submitted birth date.
 *
 * Returns the problem rather than throwing, so each caller can raise the error
 * its own boundary owes — a Zod issue on the offending field for a public form,
 * an `AppError` for a service.
 *
 * `today` is a parameter because a test that cannot control the clock either
 * skips the future check or sleeps, and both are worse than an argument.
 */
export function parseBirthDate(
  value: string,
  today: Date = new Date(),
): { ok: true; date: Date } | { ok: false; problem: BirthDateProblem } {
  const match = SHAPE.exec(value);
  if (!match) return { ok: false, problem: 'SHAPE' };

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));

  /**
   * **`new Date('2026-02-31')` is the 3rd of March**, silently. JavaScript rolls
   * an out-of-range component forward instead of refusing it, so a real
   * calendar check is reading the components back — the shared `calendarDate`
   * validator does not do this, which is why a birth date does not reuse it.
   */
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, problem: 'NOT_A_REAL_DATE' };
  }

  // Compared against the reference day's own midnight: somebody born today is
  // not in the future, and the time of day on `today` must not decide that.
  const todayMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (date.getTime() > todayMidnight) return { ok: false, problem: 'IN_THE_FUTURE' };

  const floor = Date.UTC(
    today.getUTCFullYear() - MAX_PLAUSIBLE_AGE_YEARS,
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (date.getTime() < floor) return { ok: false, problem: 'IMPLAUSIBLY_OLD' };

  return { ok: true, date };
}

/**
 * Completed years between `birthDate` and `on`.
 *
 * **Completed**, so a birthday that has not happened yet this year does not
 * count — the arithmetic that a naive year subtraction gets wrong for roughly
 * half the population on any given day. A 29th-of-February birth date reaches
 * its birthday on the 1st of March in a common year, which is the ordinary
 * reading and what `Date.UTC` produces without a special case.
 */
export function ageOn(birthDate: Date, on: Date): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * **Eligibility, never a transition.** Turning eighteen makes a person
 * *eligible* to request a self-managed account; it changes nothing on its own.
 * There is no birthday job, no automatic family-link revocation and no
 * automatic identity binding — the Owner ruled that out explicitly, because an
 * account that changes hands while nobody is looking is an account nobody
 * decided to hand over.
 */
export function isSelfManagementEligible(birthDate: Date, on: Date = new Date()): boolean {
  return ageOn(birthDate, on) >= SELF_MANAGED_AGE_YEARS;
}

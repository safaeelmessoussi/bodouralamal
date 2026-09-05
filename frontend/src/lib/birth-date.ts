/**
 * **A client-side pre-check for a date of birth. The server is the authority.**
 *
 * `backend/src/lib/birth-date.ts` holds the real rule — the calendar check, the
 * future bound, the plausibility floor and the eighteen-year threshold — and it
 * refuses by name (`SHAPE`, `NOT_A_REAL_DATE`, `IN_THE_FUTURE`,
 * `IMPLAUSIBLY_OLD`). This exists so an applicant is told *before* she submits,
 * not so the browser decides anything.
 *
 * **It deliberately checks less.** The eighteen-year rule is absent, because
 * eligibility for a self-managed account is a server decision about a stored
 * row and has no business in a registration form; and the plausibility floor is
 * absent, because the two checks below are what a typing mistake actually looks
 * like. A thinner client rule cannot drift into contradicting the server — it
 * can only be quieter than it.
 */

/**
 * True when `value` is a real calendar date that is not in the future.
 *
 * **The calendar-impossibility half is now belt-and-braces, not the whole
 * reason this exists.** `DatePicker` (2026-09-05) only ever emits a value it
 * built from a real, already-valid `Date` — it cannot produce `2010-02-31` the
 * way a keyboard-typed or pasted string once could reach here unchecked. What
 * the picker does NOT prevent is the future: nothing stops a person from
 * paging the calendar forward and choosing tomorrow, so the future-date half of
 * this check is the one still doing live work, and the calendar check stays as
 * the cheap safety net for any value that did not come from the picker at all —
 * a pre-filled draft, a value restored from storage.
 */
export function isRealPastDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  const now = new Date();
  // Compared against today's own midnight: born today is not in the future.
  return date.getTime() <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

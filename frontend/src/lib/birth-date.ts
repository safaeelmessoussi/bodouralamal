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
 * The native `type="date"` control already produces `YYYY-MM-DD` and refuses
 * most nonsense, but a keyboard-entered or pasted value reaches here unchecked —
 * and `new Date('2010-02-31')` is the 3rd of March, **silently**, which is why
 * the components are read back rather than trusted.
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

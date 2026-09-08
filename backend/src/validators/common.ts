import { z } from 'zod';

/**
 * Validator primitives shared across the API boundary (§16.2).
 *
 * **Why these are here and not in each validator module.** TD-9's column limits
 * and TD-15's optimistic-locking field are *normative constants*, and a
 * normative constant with more than one home drifts — the copy that drifts still
 * passes its own tests. `branch.validators.ts` held the only definitions until
 * Revision 43 needed the same four for administrative groups, teaching groups,
 * course schedules and sessions; that is the moment to name them once rather
 * than the moment to copy them a second time.
 */

/** TD-9: a structural entity `name` is 1–120 characters, Arabic. */
export const entityName = z.string().trim().min(1).max(120);

/**
 * TD-6 CHECK: `display_order >= 0`.
 *
 * Rejected here as well as in SQL so the caller receives a
 * `400 VALIDATION_FAILED` rather than a constraint violation surfacing as a 500.
 * Nullable, because *unordered* is a real state (BR-19 falls back to the name).
 */
export const displayOrder = z.number().int().min(0).nullable();

/**
 * NEW K/L — a short description under a name (Category, Level).
 *
 * **Empty string normalises to `null`**, because *no description* is one state
 * and not two: a form that clears the field sends `''`, and storing that beside
 * `null` would make «has a description» two different checks forever after.
 * Trimmed for the same reason a name is.
 *
 * 500 to match the column. It is a subtitle a person reads under a name, not a
 * page — the length is what says so.
 */
export const entityDescription = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((v) => (v === '' ? null : v));

/** TD-15: every edit form loads the current `version` and sends it back. */
export const version = z.coerce.number().int().min(0);

/**
 * TD-11 — a calendar date, never an instant, and a REAL Gregorian date
 * (R136, Codex M4).
 *
 * **The regex alone was the bug.** It only checks digit positions, so
 * `2026-02-30` passed it — and `new Date('2026-02-30T00:00:00.000Z')` does not
 * throw, it silently rolls forward to `2026-03-02`. Four call sites each
 * defined this validator independently (`assessment`, `exam`, `session`,
 * `course-schedule`) and all four carried the identical gap; named once here
 * rather than fixed four times and re-copied a fifth.
 *
 * The `.refine` round-trips the typed year/month/day through `Date.UTC` and
 * rejects anything that did not come back unchanged — exactly what a
 * roll-over always breaks, and nothing else: `2028-02-29` (a real leap day)
 * still passes; `2026-02-29` and `2026-02-30` do not.
 */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'not a real calendar date')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/** A path or query identifier. Malformed input is a `400`, never a lookup. */
export const uuid = z.uuid();

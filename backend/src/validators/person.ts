import { z } from 'zod';

import { parseBirthDate } from '../lib/birth-date.js';

/**
 * **The person fields, defined once** (2026-08-28).
 *
 * TD-9's limits for a person's own details lived twice: once in
 * `registration.validators.ts` for the public form, and once in
 * `user.validators.ts` for the back office — with different rules. Registration
 * collected `first_name_arabic` + `last_name_arabic` and composed the display
 * name server-side (§1.1), while the admin edit accepted the **composed**
 * `name_arabic` directly, which made the client the authority on how a person's
 * name reads on exactly the screen where a staff member retypes it.
 *
 * Both boundaries now build from these, so the two forms ask for the same
 * things under the same limits. **`.strict()` at each call site still decides
 * which of them that boundary accepts** — sharing the primitives is not sharing
 * the shape.
 */

/** TD-9: each part is 1–60. The display name is composed from them, never sent. */
export const namePart = z.string().trim().min(1).max(60);

/** Internal, for search only — never a published identity (§20 rule 21). */
export const nickname = z.string().trim().max(60);

/** TD-9: 5–20 chars, digits/`+`/spaces only; non-unique (families share phones). */
export const phone = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .regex(/^[0-9+ ]+$/, 'digits, + and spaces only');

/** TD-9: 2000 characters of free text about the person. */

/** §4.4b/R80 — recorded for everyone; the column is NOT NULL. */
export const sex = z.enum(['female', 'male']);

/**
 * **R130 — a full date of birth, validated once** (Owner, 2026-09-03).
 *
 * The parsing, the real-calendar check, the future bound and the plausibility
 * floor all live in `lib/birth-date.ts`, because four boundaries need the same
 * answer and one of them decides who may hold their own login. This wrapper only
 * translates a `problem` into the Zod issue the offending field owes.
 *
 * `new Date('2010-02-31')` is the 3rd of March, silently — which is why this is
 * NOT the shared `calendarDate` validator.
 */
export const birthDate = z
  .string()
  .superRefine((value, ctx) => {
    const parsed = parseBirthDate(value);
    if (parsed.ok) return;
    ctx.addIssue({
      code: 'custom',
      // The reason, not «تاريخ غير صالح»: an applicant who typed next year and
      // one who typed the 31st of February need different corrections.
      message:
        parsed.problem === 'SHAPE'
          ? 'expected YYYY-MM-DD'
          : parsed.problem === 'NOT_A_REAL_DATE'
            ? 'that date does not exist in the calendar'
            : parsed.problem === 'IN_THE_FUTURE'
              ? 'a date of birth cannot be in the future'
              : 'that date is implausibly far in the past',
    });
  })
  .transform((value) => new Date(`${value}T00:00:00Z`));

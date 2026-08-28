import { z } from 'zod';

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
export const notes = z.string().trim().max(2000);

/** §4.4b/R80 — recorded for everyone; the column is NOT NULL. */
export const sex = z.enum(['female', 'male']);

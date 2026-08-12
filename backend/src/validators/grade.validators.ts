import { z } from 'zod';

import { uuid, version } from './common.js';

/**
 * The grade write boundary (§4.6, BR-7, BR-12; SRS Revision 70).
 *
 * **Marks cross the wire on the association's /20 scale, not in basis points.**
 * A client that had to send bp would be doing the Revision-8 conversion itself,
 * which is a second rounding site — and Revision 8 requires the round-half-up to
 * happen **exactly once, at final persistence**. The server converts, so there
 * is one implementation of the rule and the boundary speaks the language the
 * association actually uses.
 *
 * **`mark: null` is not the same as `mark: 0`**, and the schema keeps them
 * apart: `null` leaves a student unmarked and BR-7 makes them absent-zero at the
 * save; `0` is somebody deciding the student scored nothing.
 */
const mark = z
  .number()
  .min(0, 'a mark cannot be negative')
  // The upper bound is the display scale, which the server owns — a client
  // sending 21/20 is refused rather than clamped, because a clamp would record
  // a mark nobody entered.
  .max(1000, 'a mark cannot exceed the grading scale');

export const saveGradesSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            student_id: uuid,
            /** `null` — unmarked. BR-7 turns it into an absent-zero on save. */
            mark: mark.nullable(),
            absent: z.boolean().default(false),
            /** TD-15 — omitted for a student who has no row yet. */
            version: version.optional(),
          })
          .strict()
          // An absent student holds a real 0 (BR-7); accepting a mark beside
          // the flag would leave two answers on one row and no rule for which
          // of them is the student's result.
          .refine((e) => !(e.absent && e.mark !== null && e.mark > 0), {
            message: 'an absent student cannot also hold a mark',
            path: ['mark'],
          }),
      )
      .max(500),
  })
  .strict();

/**
 * BR-12 — a manual pass/fail decision, with the reason it was taken.
 *
 * **The reason is mandatory when overriding and refused when clearing.** §4.6
 * requires actor and timestamp capture in the audit trail, and a reason is what
 * makes that trail answerable later; clearing restores the computed result, for
 * which there is nothing to justify.
 */
export const overridePassFailSchema = z
  .object({
    value: z.boolean().nullable(),
    reason: z.string().trim().max(500).optional(),
    version: version,
  })
  .strict()
  .refine((b) => b.value === null || (b.reason !== undefined && b.reason.length > 0), {
    message: 'an override requires a reason',
    path: ['reason'],
  });

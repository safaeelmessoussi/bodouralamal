import { z } from 'zod';

import { uuid, version } from './common.js';
import { calendarDate, wallClock } from './course-schedule.validators.js';

/**
 * Zod schemas for the Session boundary (TD-3.12, §4.4, TD-1).
 *
 * **`status` is never a field a client may set.** A Session moves between states
 * through the verbs that own each transition — `/cancel`, `/restore` — because a
 * transition carries obligations a field assignment cannot: a cancellation must
 * state a reason and record how many people it affected, and a restore is
 * refused once the date has passed. `PATCH` accepting `status` would offer a
 * second route into the same state machine with none of that attached, and
 * `.strict()` therefore refuses the key outright.
 */

/**
 * A single occurrence's own values (Revision 43.4).
 *
 * **`schedule_id` is absent and refused.** Moving an occurrence to a different
 * schedule would detach it from the recurrence that explains it, leaving a row
 * that no schedule edit will ever reach again.
 */
export const overrideSessionSchema = z
  .object({
    version,
    date: calendarDate.optional(),
    start_time: wallClock.optional(),
    end_time: wallClock.optional(),
    room_id: uuid.nullable().optional(),
    /**
     * Supplying this **replaces** this occurrence's staffing snapshot; omitting
     * it leaves the snapshot untouched. An empty array is therefore a real
     * instruction — *this session has no staff* — and is deliberately not the
     * same as omission.
     */
    staff: z
      .array(z.object({ user_id: uuid, position: z.enum(['teacher', 'assistant']) }).strict())
      .max(20)
      .optional(),
  })
  .strict();

/**
 * **The reason is mandatory and cannot be whitespace** (§4.4). A cancellation
 * that says nothing is indistinguishable later from one whose reason was lost,
 * and it is the only record of *why* a class did not happen.
 */
export const cancelSessionSchema = z
  /**
   * R83.2 — **the reason is OPTIONAL.** R77 required it, and the Owner has
   * decided otherwise: a class is sometimes simply not held, and demanding a
   * sentence before the platform will record that is a gate with no purpose.
   * An empty string is normalised to absent, so *«»* and *nothing* are one
   * state rather than two that render differently.
   */
  .object({
    version,
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
  })
  .strict();

export const restoreSessionSchema = z.object({ version }).strict();

/**
 * **The key is `educational_content_id`, exactly as TD-3.12 names it.** A
 * shorter `content_id` reads better and would have been wrong: `.strict()` makes
 * the boundary refuse anything else, so a client following the specification
 * would have received a `400` from an endpoint that claimed to implement it.
 */
export const linkContentSchema = z.object({ educational_content_id: uuid }).strict();

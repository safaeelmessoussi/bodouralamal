import { z } from 'zod';

import { displayOrder, entityName, uuid, version } from './common.js';

/**
 * Zod schemas for the Administrative Group boundary (TD-3.12, §4.4c).
 *
 * **What is NOT accepted is the substance of this file.** Revision 43 separated
 * organisation from delivery, so a group takes a Level, a Branch, a name and an
 * ordering — and nothing else. `.strict()` therefore **rejects** `room_id`,
 * `teacher_id`, `assistant_id`, `day_of_week`, `start_time` and above all
 * `max_students`, rather than silently dropping them: a client that sent a
 * capacity and received `201` would reasonably believe a limit was recorded,
 * and BR-23 says no limit exists to record.
 */

/** The four keys a group actually has. Anything else is refused (§20 rule 22). */
export const createAdministrativeGroupSchema = z
  .object({
    name: entityName,
    level_id: uuid,
    branch_id: uuid,
    display_order: displayOrder.optional(),
  })
  .strict();

/**
 * **`level_id` and `branch_id` are absent by design, and `.strict()` refuses
 * them.** Moving a group to another Level would invalidate every
 * `Enrollment.level_id` pointing at it — the composite FK would refuse the
 * write, but as an opaque constraint error rather than an explained refusal.
 * Moving it to another Branch would change where its students are recorded as
 * attending, without anyone deciding that per student. Both are re-creations,
 * not edits, and the service says so too.
 */
export const updateAdministrativeGroupSchema = z
  .object({
    version,
    name: entityName.optional(),
    display_order: displayOrder.optional(),
  })
  .strict();

/**
 * List filters. Validated rather than passed through: a malformed `level_id`
 * must be a `400`, because the alternative — Prisma matching nothing — renders
 * as *"this Level has no groups"*, which is a different and more misleading
 * answer than *"that is not an id"*.
 *
 * Not `.strict()`: TD-10's `page`/`page_size` arrive in the same query object,
 * and this schema is deliberately only about the filters.
 */
export const listAdministrativeGroupsQuerySchema = z.object({
  level_id: uuid.optional(),
  branch_id: uuid.optional(),
});

/**
 * Roster enrolment (TD-3.12). **`level_id` is deliberately not accepted** — the
 * service reads it from the group, because taking it from the caller would make
 * the composite FK the only thing standing between a typo and a mis-filed
 * student, surfacing as an opaque constraint error rather than a decision.
 */
export const enrolStudentSchema = z.object({ student_id: uuid }).strict();

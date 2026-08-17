import { z } from 'zod';

import { displayOrder, entityName, uuid, version } from './common.js';

/**
 * Zod schemas for the Teaching Group boundary (TD-3.12, §4.4c, Revision 43).
 *
 * **`level_id` and `subject_id` are never accepted in a body — they are path
 * segments.** The pair identifies *which split of which subject*, and
 * `StudentTeachingGroup` carries the same pair denormalized, kept honest by a
 * composite FK (Revision 43.2). Accepting them from a body would make that FK
 * the only guard between a typo and a seat filed under the wrong curriculum
 * item, surfacing as an opaque constraint error rather than a refusal anyone
 * decided on.
 */

/**
 * `GET /admin/teaching-groups` — **every parameter narrows, none is required.**
 *
 * That is the whole contract, and it is the point: the flat read exists so a
 * management screen can show its data before anything is chosen, so a required
 * filter here would reintroduce the gate at the API instead of in the UI.
 *
 * **No `branch_id`.** A circle carries no branch (R43.3), and *"circles at
 * Marrakesh"* could only mean *"circles at least one of whose members is
 * enrolled at Marrakesh"* — a different question, answered silently. §20 rule 22
 * forbids conflating the organisational unit with its delivery.
 *
 * Not `.strict()`, because TD-10's `page` / `page_size` arrive on the same query
 * object and are read by `pageParamsFrom` rather than by this schema.
 */
export const listTeachingGroupsQuerySchema = z.object({
  level_id: uuid.optional(),
  subject_id: uuid.optional(),
  category_id: uuid.optional(),
  /** Free text over the circle, its Level and its Subject — the three things
   *  visible in the row. Bounded so a query cannot be an unbounded scan term. */
  q: z.string().trim().min(1).max(120).optional(),
});

/** Path-derived Level and Subject; the body carries only what a group *is*. */
export const createTeachingGroupSchema = z
  .object({
    name: entityName,
    display_order: displayOrder.optional(),
  })
  .strict();

/**
 * **Subject and Level are absent by design, and `.strict()` refuses them.**
 * Either would break the composite FK that keeps every member row's
 * `(subject, level)` agreeing with its group's, and would silently re-file a
 * whole cohort under a different curriculum item. That is a re-creation, not an
 * edit — the service says the same thing.
 */
export const updateTeachingGroupSchema = z
  .object({
    version,
    name: entityName.optional(),
    display_order: displayOrder.optional(),
  })
  .strict();

/**
 * Membership (TD-3.12, §4.4c). One key: the student. The Subject and Level come
 * from the group, so *at most one seat per (student, subject, level)* is a rule
 * the service can enforce against values it chose rather than values it was
 * handed.
 */
export const addTeachingGroupMemberSchema = z.object({ student_id: uuid }).strict();

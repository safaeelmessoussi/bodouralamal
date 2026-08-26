import { z } from "zod";

import { uuid, version } from "./common.js";
import {
  calendarDate,
  checkDelivery,
  deliveryMode,
  onlineMediaMode,
  visibility,
  wallClock,
} from "./course-schedule.validators.js";

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
     * **R97 — this occurrence's own delivery**, on exactly the footing
     * `room_id` has: supplying it overrides the schedule's default for this
     * date and nothing else, and the `overridden` flag `session.override`
     * already sets is what protects it from the next resync. There is no
     * separate "online override" endpoint, because this one represents it.
     *
     * The same `checkDelivery` the schedule boundary uses — one rule, one
     * copy, so an occurrence can never reach a combination a schedule could
     * not.
     */
    delivery_mode: deliveryMode.optional(),
    online_media_mode: onlineMediaMode.nullable().optional(),
    /**
     * **R109 — this occurrence's own tier**, on exactly the footing `room_id`
     * has. Supplying it decides this date and nothing else, and the `overridden`
     * flag `session.override` already sets is what protects it from the next
     * resync. There is no separate "hide one occurrence" endpoint, because this
     * one represents it.
     *
     * The same shared enum the schedule boundary uses — one vocabulary, one
     * copy, so an occurrence can never reach a tier a schedule could not.
     */
    visibility: visibility.optional(),
    /**
     * Supplying this **replaces** this occurrence's staffing snapshot; omitting
     * it leaves the snapshot untouched. An empty array is therefore a real
     * instruction — *this session has no staff* — and is deliberately not the
     * same as omission.
     */
    staff: z
      .array(
        z
          .object({ user_id: uuid, position: z.enum(["teacher", "assistant"]) })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine(checkDelivery);

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
      .transform((v) => (v === undefined || v === "" ? null : v)),
  })
  .strict();

export const restoreSessionSchema = z.object({ version }).strict();

/**
 * **The key is `educational_content_id`, exactly as TD-3.12 names it.** A
 * shorter `content_id` reads better and would have been wrong: `.strict()` makes
 * the boundary refuse anything else, so a client following the specification
 * would have received a `400` from an endpoint that claimed to implement it.
 */
export const linkContentSchema = z
  .object({ educational_content_id: uuid })
  .strict();

/**
 * **R92 — this occurrence's audience branches.**
 *
 * `.strict()`, and the version is required: the concurrency control is the
 * Session's own (TD-15), never a second mechanism.
 *
 * **An empty list is meaningful and is accepted**: it clears the override and
 * returns the audience to the schedule's, which is what «العودة إلى الوضع
 * المعتاد» does. That is why there is no `.min(1)`.
 */
export const sessionAudienceSchema = z
  .object({
    version: z.number().int().min(0),
    branch_ids: z.array(uuid).max(20),
  })
  .strict();

/**
 * **R98 — joining an online class carries NOTHING.**
 *
 * An empty `.strict()` object, and that emptiness is the security property
 * rather than an omission waiting to be filled. Participant identity, room,
 * role, grants and expiry are all resolved server-side from the authenticated
 * caller and the Session in the path; a body that could name any of them is a
 * body that could name somebody else's.
 *
 * `.strict()` means a forged `identity`, `room`, `role`, `student_id` or
 * `can_publish` is a `400` at the boundary rather than a field quietly ignored
 * by a service — the same discipline R97's delivery fields are refused with
 * (rule AF: identity is refused by the server, not hidden by the form).
 *
 * **No `version`.** Joining reads; it changes no row, so there is nothing to
 * lose to a concurrent edit (TD-15).
 */
export const onlineJoinSchema = z.object({}).strict();


/**
 * **R99 — starting and stopping a recording carry nothing either.**
 *
 * Same reasoning as `onlineJoinSchema`: the occurrence is in the path and
 * everything else is resolved server-side. In particular there is **no
 * `media_mode`** — the format follows the class (R99.7), and letting a client
 * name it would let a مؤطِّرة record video of a صوت فقط class, which is exactly
 * the semantics R97 established and R99 preserves.
 */
export const recordingCommandSchema = z.object({}).strict();

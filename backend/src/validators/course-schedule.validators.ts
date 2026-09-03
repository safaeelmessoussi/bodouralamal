import { z } from "zod";

import { uuid, version } from "./common.js";

/**
 * Zod schemas for the Recurring Course Schedule boundary (TD-3.12, §4.4).
 *
 * **A schedule takes exactly one target, named by the mode** (§4.4c). The wire
 * shape is therefore `{ teaching_mode, target_id }` and **not** three nullable
 * columns: a body carrying `level_id` *and* `administrative_group_id` has no
 * correct reading, and the database CHECK that refuses it
 * (`course_schedule_mode_target_check`) would report it as a constraint
 * violation rather than as the ambiguity it is. One field cannot be ambiguous.
 */

export const teachingMode = z.enum([
  "entire_level",
  "administrative_group",
  "teaching_group",
]);

export const recurrence = z.enum([
  "none",
  "daily",
  "weekly",
  "multiple_weekdays",
  "biweekly_alternating",
  "monthly",
  "yearly",
]);

export const weekday = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

/**
 * **A wall-clock time, not an instant** (TD-11). `HH:MM` or `HH:MM:SS`, parsed
 * into the UTC epoch day because the column is `TIME(0)` and Prisma reads and
 * writes it as a `Date` whose date part is ignored.
 *
 * Refusing an ISO instant here is the point: accepting `2026-08-05T14:00:00Z`
 * would make a class's start time depend on the sender's timezone, which is the
 * exact bug TD-11 separates the two kinds of value to prevent.
 */
export const wallClock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "expected HH:MM or HH:MM:SS")
  .transform((v) => new Date(`1970-01-01T${v.length === 5 ? `${v}:00` : v}Z`));

/** A TD-11 calendar date — `YYYY-MM-DD`, never an instant. */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .transform((v) => new Date(`${v}T00:00:00Z`));

/**
 * **R91 — an assignment carries its effective period.**
 *
 * Both bounds optional and **explicitly nullable**: `null` is *open-ended at
 * that end*, and omitting the key means the same thing. That equivalence is
 * deliberate — a form that clears a date sends `null`, and one that never had
 * the field sends nothing, and both must mean *no bound*.
 *
 * `effective_from <= effective_until` is refused here as well as by the database
 * CHECK, so the caller gets a field-level message rather than a constraint name.
 */
const staff = z
  .array(
    z
      .object({
        user_id: uuid,
        position: z.enum(["teacher", "assistant"]),
        effective_from: calendarDate.nullable().optional(),
        effective_until: calendarDate.nullable().optional(),
      })
      .strict()
      .refine(
        (v) =>
          v.effective_from == null ||
          v.effective_until == null ||
          v.effective_from <= v.effective_until,
        {
          message: "effective_from must not follow effective_until",
          path: ["effective_until"],
        },
      ),
  )
  .max(20);

/**
 * **R97 — delivery, validated as ONE fact rather than three loose fields.**
 *
 * `delivery_mode` decides which of the other two are meaningful, so the three
 * are refused or accepted together:
 *
 * | delivery | `online_media_mode` | `room_id` |
 * |---|---|---|
 * | `in_person` | **must be absent** | optional (§4.4c: a class may have no room) |
 * | `online`    | **required**       | **must be absent** |
 *
 * **Both directions are refused, not just the missing one.** An in-person class
 * carrying `audio_only` is a client that believes something false about the row
 * it is writing, and silently dropping the key would leave that belief intact
 * (§20 rule 12). The same equivalence is a database CHECK
 * (`course_schedule_delivery_check`) — the boundary exists to name the field,
 * not to be the only guard.
 *
 * **Shared by every write path** — schedule create, schedule update and
 * `session.override` — because it is one rule about one concept, and three
 * copies would drift the way every duplicated rule on this project has.
 */
export const deliveryMode = z.enum(["in_person", "online"]);
export const onlineMediaMode = z.enum(["audio_video", "audio_only"]);

/**
 * **R109 — the shared visibility vocabulary** (§4.4), one enum for every
 * scheduling kind. `Event`, `RecurringCourseSchedule`, `Session` and `Exam` all
 * take the same three values, so they take the same schema: a fourth spelling
 * of the same list is the drift this project has paid for every time.
 */
export const visibility = z.enum(["public", "private", "hidden"]);

export interface DeliveryFields {
  delivery_mode?: "in_person" | "online" | undefined;
  online_media_mode?: "audio_video" | "audio_only" | null | undefined;
  room_id?: string | null | undefined;
}

/**
 * Applies the table above to any schema carrying the three keys.
 *
 * **A partial edit that mentions delivery must state it whole.** `PATCH`ing
 * `delivery_mode: 'online'` alone cannot be validated against the stored row
 * here, and half-applying it would leave a class online with no media mode —
 * a state the CHECK would then refuse with a constraint name instead of a
 * field-level message. So naming the mode means naming what goes with it, and
 * naming a media mode without the mode is refused outright.
 */
export function checkDelivery(
  v: DeliveryFields,
  ctx: z.RefinementCtx,
): void {
  if (v.delivery_mode === undefined && v.online_media_mode != null) {
    ctx.addIssue({
      code: "custom",
      path: ["online_media_mode"],
      message: "online_media_mode requires delivery_mode (R97)",
    });
  }
  if (v.delivery_mode === "online" && v.online_media_mode == null) {
    ctx.addIssue({
      code: "custom",
      path: ["online_media_mode"],
      message: "an online class must say audio_video or audio_only (R97)",
    });
  }
  if (v.delivery_mode === "in_person" && v.online_media_mode != null) {
    ctx.addIssue({
      code: "custom",
      path: ["online_media_mode"],
      message: "an in-person class has no online media mode (R97)",
    });
  }
  if (v.delivery_mode === "online" && v.room_id != null) {
    ctx.addIssue({
      code: "custom",
      path: ["room_id"],
      message: "an online class occupies no room (R97)",
    });
  }
}

/** R57 — TD-9's bounds for a class's own name. The same limits `Event` takes,
 *  because they are the same kind of field. */
const scheduleTitle = z.string().trim().min(1).max(120);
const scheduleDescription = z.string().trim().max(2000).nullable().optional();

export const createCourseScheduleSchema = z
  .object({
    title: scheduleTitle,
    description: scheduleDescription,
    subject_id: uuid,
    teaching_mode: teachingMode,
    target_id: uuid,
    branch_id: uuid,
    room_id: uuid.nullable().optional(),
    /** R97 — the DEFAULT delivery for the Sessions this schedule materializes.
     *  Optional and `in_person` when absent, which is the column's default and
     *  what every class the association has ever scheduled actually was. */
    delivery_mode: deliveryMode.optional(),
    online_media_mode: onlineMediaMode.nullable().optional(),
    /** R109 — the DEFAULT tier for the Sessions this schedule materializes.
     *  Optional and `public` when absent, which is the column's default and what
     *  every class the association has ever scheduled actually was. */
    visibility: visibility.optional(),
    start_time: wallClock,
    end_time: wallClock,
    recurrence,
    weekdays: z.array(weekday).optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    month_of_year: z.number().int().min(1).max(12).nullable().optional(),
    anchor_date: calendarDate.nullable().optional(),
    /**
     * **The last date the rule produces occurrences for** (R50's
     * `effective_until`, exposed on the contract by R55).
     *
     * The column has existed since R50 and could only be set as a *side effect*
     * of splitting a schedule, so a class that runs for one term had no way to
     * say so — while an Event, the other half of the same scheduling module, has
     * carried a recurrence end since it shipped. Null is open-ended.
     */
    effective_until: calendarDate.nullable().optional(),
    /**
     * **Which catalogue row this is** (R110, Owner 2026-09-02) — «حصة دراسية»
     * or «محاضرة», which are distinct types sharing one `structural_kind`.
     * Refused unless it names a live type whose kind is `class`.
     *
     * Optional and nullable: every row predating the catalogue records none,
     * and it is editable precisely so those can be resolved by someone who
     * knows what they were, rather than guessed by a backfill.
     */
    scheduling_type_id: uuid.nullable().optional(),
    /**
     * **R123 — who may record presence at this class's occurrences.**
     *
     * Absent is `staff_only`: a setting nobody chose must never be the
     * permissive one. `self_or_staff` is refused on a type that takes no
     * attendance, and even where it is accepted it grants a teen or a child
     * nothing — the Category decides that, server-side.
     */
    attendance_marking: z.enum(['staff_only', 'self_or_staff']).optional(),
    academic_year_id: uuid,
    staff: staff.optional(),
  })
  .strict()
  .superRefine(checkDelivery);

/**
 * **Subject, target, branch and academic year are not editable**, and `.strict()`
 * refuses them rather than dropping them. Each would change *what is taught, to
 * whom, or where* while keeping the sessions already materialized against the
 * old answer — an edit that silently re-points a term's worth of history. They
 * are re-creations, exactly as moving an Administrative Group between Levels is.
 *
 * What remains editable is the *when* and the *where in the building*: room,
 * times and the recurrence rule, which is precisely what §4.4 promises rewrites
 * future Sessions.
 */
export const updateCourseScheduleSchema = z
  .object({
    version,
    // **Editable, unlike the scope fields below.** Renaming a class changes
    // nothing about what was taught, to whom or when — which is exactly why
    // §4.4 freezes subject/target/branch/year and does not freeze this (R57).
    title: scheduleTitle.optional(),
    description: scheduleDescription,
    room_id: uuid.nullable().optional(),
    /** R97 — editable, and it rewrites the FUTURE un-protected occurrences
     *  through the ordinary resync. The past keeps what it was delivered as. */
    delivery_mode: deliveryMode.optional(),
    online_media_mode: onlineMediaMode.nullable().optional(),
    /** R109 — editable, and it rewrites the FUTURE un-protected occurrences
     *  through the ordinary resync. The past keeps the tier it was materialized
     *  with. **Omitting it leaves the tier alone**; it is never a reset. */
    visibility: visibility.optional(),
    start_time: wallClock.optional(),
    end_time: wallClock.optional(),
    recurrence: recurrence.optional(),
    weekdays: z.array(weekday).optional(),
    day_of_month: z.number().int().min(1).max(31).nullable().optional(),
    month_of_year: z.number().int().min(1).max(12).nullable().optional(),
    anchor_date: calendarDate.nullable().optional(),
    effective_until: calendarDate.nullable().optional(),
    /**
     * **Which catalogue row this is** (R110, Owner 2026-09-02) — «حصة دراسية»
     * or «محاضرة», which are distinct types sharing one `structural_kind`.
     * Refused unless it names a live type whose kind is `class`.
     *
     * Optional and nullable: every row predating the catalogue records none,
     * and it is editable precisely so those can be resolved by someone who
     * knows what they were, rather than guessed by a backfill.
     */
    scheduling_type_id: uuid.nullable().optional(),
    /**
     * **R123 — who may record presence at this class's occurrences.**
     *
     * Absent is `staff_only`: a setting nobody chose must never be the
     * permissive one. `self_or_staff` is refused on a type that takes no
     * attendance, and even where it is accepted it grants a teen or a child
     * nothing — the Category decides that, server-side.
     */
    attendance_marking: z.enum(['staff_only', 'self_or_staff']).optional(),
    /**
     * **Staffing is editable** (R90).
     *
     * It was accepted on CREATE and refused on UPDATE, while the form rendered
     * the controls on both — so an administrator could change the مؤطِّرة on an
     * existing class, save, and be told the request was invalid. Replaced whole
     * for the same reason the create path takes it whole: *this is who staffs
     * it now*, and a partial verb leaves *who was removed* unanswerable.
     *
     * **Past occurrences are never rewritten.** A reassignment changes the
     * schedule and its FUTURE un-overridden sessions; whoever actually
     * delivered a past class stays recorded against it (§4.4, R43.4).
     */
    staff: staff.optional(),
    /**
     * **SRS Revision 50 — which occurrences this edit applies to.**
     *
     * Absent or `all_sessions` is the behaviour that predates R50: future
     * un-overridden Sessions are rewritten. `this_and_future` **splits the
     * schedule** and requires `from_date`.
     *
     * *This session only* is deliberately **not** a value here — it is
     * `PATCH /sessions/{id}`, a different endpoint on a different resource,
     * because it edits one occurrence rather than the rule that produced it.
     */
    scope: z.enum(["all_sessions", "this_and_future"]).optional(),
    /** The occurrence the split begins at. Refused without the scope, so a
     *  stray date can never silently split a series. */
    from_date: calendarDate.optional(),
  })
  .strict()
  .refine((v) => v.scope !== "this_and_future" || v.from_date !== undefined, {
    path: ["from_date"],
    message: "this_and_future requires from_date (§4.4, Revision 50)",
  })
  .refine((v) => v.from_date === undefined || v.scope === "this_and_future", {
    path: ["from_date"],
    message: "from_date is only meaningful with scope this_and_future",
  })
  .superRefine(checkDelivery);

/** Not `.strict()`: TD-10's `page`/`page_size` share the query object. */
export const listCourseSchedulesQuerySchema = z.object({
  branch_id: uuid.optional(),
  subject_id: uuid.optional(),
  academic_year_id: uuid.optional(),
});

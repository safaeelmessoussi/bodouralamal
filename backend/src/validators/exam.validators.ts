import { z } from 'zod';

import { uuid, version } from './common.js';

/**
 * The exam write boundary (§4.6 as amended by SRS Revision 58).
 *
 * **`mode` is accepted and only `physical` is legal.** Naming the value the
 * schema will refuse is what makes the refusal a *coded* answer rather than a
 * mystery: the interface offers `online` disabled, and a client that sends it
 * anyway is told exactly which capability is not built.
 *
 * The place fields are **required here** even though the columns are nullable.
 * That is §7's standing division, the one the Branch address columns already
 * take (R35): nullable in the database for rows that predate the requirement,
 * required at the write boundary, which is where a real value can be demanded.
 */
const wallClock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')
  // TD-11: a wall-clock value, never an instant. Parked on the epoch date so the
  // column stores a time and nothing about a timezone.
  .transform((v) => new Date(`1970-01-01T${v}:00Z`));

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00Z`));

/** One supervisor and any number of assistants — the shape `CourseScheduleStaff`
 *  already uses (§4.4c). */
const staff = z
  .array(z.object({ user_id: uuid, position: z.enum(['supervisor', 'assistant']) }).strict())
  .max(20);

/**
 * R81 — the exam's maximum grade: **required, positive, two decimals**.
 *
 * Two places is where the column stores, so a third would be rounded silently
 * by PostgreSQL and read back as something other than what was typed. Refusing
 * it here is what keeps *what you entered is what you see* true.
 */
const maxGrade = z
  .number()
  .positive()
  .max(9999.99)
  .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: 'at most two decimal places',
  });

export const createExamSchema = z
  .object({
    mode: z.enum(['physical', 'online']).default('physical'),
    title: z.string().trim().min(1).max(120),
    max_grade: maxGrade,
    description: z.string().trim().max(2000).nullable().optional(),
    date: calendarDate,
    start_time: wallClock,
    end_time: wallClock,
    level_id: uuid,
    subject_id: uuid,
    academic_year_id: uuid,
    branch_id: uuid,
    room_id: uuid,
    /** Absent or null is **the whole Level** (R58), never "no target". */
    administrative_group_id: uuid.nullable().optional(),
    staff: staff.optional(),
  })
  .strict();

/**
 * **`mode`, `level_id`, `subject_id`, `academic_year_id` and `branch_id` are not
 * editable**, and `.strict()` refuses them rather than dropping them.
 *
 * Each would change *what is being examined, for whom, or where* while keeping
 * the grades and submissions already recorded against the old answer — the same
 * reasoning §4.4 applies to a course schedule's scope. Moving an exam to another
 * level is a new exam.
 *
 * The room, the date, the clock window, the narrower target and the staff **are**
 * editable: those are arrangements, and arrangements change.
 */
export const updateExamSchema = z
  .object({
    version,
    title: z.string().trim().min(1).max(120).optional(),
    max_grade: maxGrade.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    date: calendarDate.optional(),
    start_time: wallClock.optional(),
    end_time: wallClock.optional(),
    room_id: uuid.optional(),
    administrative_group_id: uuid.nullable().optional(),
    staff: staff.optional(),
  })
  .strict();

/** Not `.strict()`: TD-10's `page`/`page_size` share the query object. */
export const listExamsQuerySchema = z.object({
  branch_id: uuid.optional(),
  level_id: uuid.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // R76 — the sort is validated against the endpoint's own allow-list in
  // `resolveSort`, which refuses an unknown field rather than ignoring it. The
  // schema only has to let the two names through.
  sort_by: z.string().optional(),
  sort_dir: z.string().optional(),
});

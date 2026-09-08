import { z } from 'zod';

import { calendarDate, uuid } from './common.js';
import { assessmentTarget } from './assessment.validators.js';
import { visibility } from './course-schedule.validators.js';

/**
 * **الجدولة — the one write boundary for scheduling an exam occurrence,
 * physical or remote** (R136).
 *
 * One combined body for one combined form: the client fills نوع الامتحان،
 * ورقة الاختبار where applicable، الجمهور، المكان where applicable، التاريخ،
 * الوقت، الإتاحة, then سaves once. `.strict()` throughout, so a misspelled or
 * mode-inappropriate key is refused rather than silently ignored.
 */

const wallClock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')
  .transform((v) => new Date(`1970-01-01T${v}:00Z`));

const maxGrade = z
  .number()
  .positive()
  .max(9999.99)
  .refine(
    (v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9,
    { message: 'at most two decimal places' },
  );

const staff = z
  .array(z.object({ user_id: uuid, position: z.enum(['supervisor', 'assistant']) }).strict())
  .max(20);

/**
 * **R136 clause 9/10 — six UX policies, one stored fact.** `at_start` and
 * `offset_minutes` need a real start time to anchor on, checked in the
 * service rather than here (the schema alone cannot see `start_time`'s
 * value). `custom` carries its own full instant — a bare calendar date is not
 * enough to say *when* an exam opens.
 */
const availability = z
  .discriminatedUnion('policy', [
    z.object({ policy: z.literal('manual') }).strict(),
    z.object({ policy: z.literal('at_start') }).strict(),
    z.object({ policy: z.literal('offset_minutes'), minutes: z.number().int().min(1).max(1440) }).strict(),
    z.object({ policy: z.literal('custom'), at: z.iso.datetime({ offset: true }) }).strict(),
  ])
  .optional();

const bare = z
  .object({
    title: z.string().trim().min(1).max(120),
    max_grade: maxGrade,
    description: z.string().trim().max(2000).nullable().optional(),
    level_id: uuid,
    subject_id: uuid,
    academic_year_id: uuid,
  })
  .strict()
  .optional();

export const scheduleExamSchema = z
  .object({
    mode: z.enum(['physical', 'online']),
    /** Required for `online`; optional for `physical` (R136 §19 — the
     *  existing simple/grade-only workflow stays content-free). */
    source_exam_id: uuid.optional(),
    target: assessmentTarget,
    date: calendarDate.optional(),
    start_time: wallClock.optional(),
    end_time: wallClock.optional(),
    branch_id: uuid.optional(),
    room_id: uuid.optional(),
    scheduling_type_id: uuid.nullable().optional(),
    visibility: visibility.optional(),
    staff: staff.optional(),
    availability,
    /** Required exactly when `source_exam_id` is absent for a `physical`
     *  exam — its own title/maximum/Level/Subject/year, since there is no
     *  source to take them from. */
    bare,
  })
  .strict();

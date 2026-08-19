import { z } from 'zod';

import { uuid } from './common.js';

/**
 * The teaching profile's write boundary (R88).
 *
 * **`HH:MM`, refused rather than coerced.** The store holds `TIME(0)`, so a
 * value carrying seconds would be silently truncated and read back as something
 * other than what was sent — the same rounding-surprise argument R81 made about
 * grades.
 */
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const teachingProfileSchema = z
  .object({
    subject_ids: z.array(uuid).max(50),
    category_ids: z.array(uuid).max(20),
    availability: z
      .array(
        z
          .object({
            weekday: z.enum(WEEKDAYS),
            start_time: clock,
            end_time: clock,
          })
          .strict()
          // A range that ends before it starts is not a range — refused here as
          // well as by the CHECK, so the caller gets a field error rather than a
          // constraint violation.
          .refine((r) => r.start_time < r.end_time, {
            message: 'start_time must precede end_time',
            path: ['end_time'],
          }),
      )
      .max(50),
  })
  .strict();

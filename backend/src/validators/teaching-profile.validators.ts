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

/**
 * One availability range, defined once and used by both writers — the
 * administration's whole-profile PUT and R106's self-service one. Restating it
 * would be two shapes for one table that happen to agree today.
 */
const availabilityRange = z
  .object({
    weekday: z.enum(WEEKDAYS),
    start_time: clock,
    end_time: clock,
    // Nullable preserves pre-revision ranges honestly: absence means the
    // person did not state a modality, never an inferred in-person default.
    mode: z.enum(['in_person', 'online', 'both']).nullable().optional(),
  })
  .strict()
  // A range that ends before it starts is not a range — refused here as
  // well as by the CHECK, so the caller gets a field error rather than a
  // constraint violation.
  .refine((r) => r.start_time < r.end_time, {
    message: 'start_time must precede end_time',
    path: ['end_time'],
  });

export const teachingProfileSchema = z
  .object({
    subject_ids: z.array(uuid).max(50),
    category_ids: z.array(uuid).max(20),
    availability: z.array(availabilityRange).max(50),
  })
  .strict();

/**
 * **R106 — what a مؤطِّرة may send about herself: her ranges, and nothing else.**
 *
 * `.strict()` is the guard, not a formality. Were `subject_ids` merely ignored
 * rather than refused, a forged request would look like it had rewritten what
 * she is authorised to teach, and the response — which returns the profile —
 * would appear to confirm it. Refusing the field is what makes the narrowness
 * of this grant legible at the boundary rather than only in the service.
 */
export const ownAvailabilitySchema = z
  .object({ availability: z.array(availabilityRange).max(50) })
  .strict();

/**
 * **What a مؤطِّرة may send about her own capabilities** (Owner, 2026-08-30).
 *
 * The counterpart of `ownAvailabilitySchema`, and `.strict()` for the same
 * reason read in the other direction: `availability` is **refused here**, not
 * ignored. Each self-service path replaces exactly the half its route names, so
 * a stale tab cannot silently erase the half it did not load — and a forged
 * body cannot make one endpoint do the other's job.
 *
 * The bounds match the administrative schema's: the same two tables, the same
 * limits, one set of rules.
 */
export const ownCapabilitiesSchema = z
  .object({
    subject_ids: z.array(uuid).max(50),
    category_ids: z.array(uuid).max(20),
  })
  .strict();

/**
 * **The planning appraisal's read boundary** (R90).
 *
 * A query, not a body: this asks *who would suit this class* and stores nothing.
 * `.strict()` all the same — a query parameter the server silently ignores is
 * one a screen believes it is using, which is how `?content_id=` shipped for
 * months reading nothing at all (rule AB).
 *
 * **Every filter is optional except the time and the recurrence**, because
 * those are what the appraisal is *about*. A class with no Subject named yet is
 * a form half filled in, and the appraisal answers what it can rather than
 * refusing until the administrator finishes.
 */
export const teachingCandidatesQuerySchema = z
  .object({
    subject_id: uuid.optional(),
    level_id: uuid.optional(),
    branch_id: uuid.optional(),
    exclude_schedule_id: uuid.optional(),
    recurrence: z.enum([
      'daily',
      'weekly',
      'multiple_weekdays',
      'biweekly_alternating',
      'monthly',
      'yearly',
    ]),
    // Comma-separated, the shape every other list parameter on this API uses.
    weekdays: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : []))
      .pipe(z.array(z.enum(WEEKDAYS)).max(7)),
    start_time: clock,
    end_time: clock,
    delivery_mode: z.enum(['in_person', 'online']).optional(),
  })
  .strict()
  .refine((v) => v.start_time < v.end_time, {
    message: 'start_time must precede end_time',
    path: ['end_time'],
  });

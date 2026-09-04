import { z } from 'zod';

/**
 * **The write boundary for the assessment builder** (SRS §4.6, R124).
 *
 * Every shape a question kind cannot have is refused here or in the service —
 * never dropped. A `201` after silently discarding a key tells a client its
 * request was understood when it was not.
 */

/** TD-11 — a calendar date, never an instant. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export const assessmentTarget = z
  .object({
    kind: z.enum(['level', 'administrative_group', 'session', 'teaching_group', 'student']),
    /** Absent only for `level`, which names nothing beyond the Level itself. */
    id: z.uuid().optional(),
  })
  .strict();

export const createAssessmentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    /** R81 — every paper states what its marks are out of. */
    max_grade: z.coerce.number().positive().max(9999.99),
    level_id: z.uuid(),
    subject_id: z.uuid().nullable().optional(),
    academic_year_id: z.uuid().nullable().optional(),
    target: assessmentTarget,
    /**
     * Refused on a `session` target: the occurrence's own date is the answer,
     * and accepting a second one would let the two disagree about which day the
     * audience is resolved for.
     */
    date: calendarDate.optional(),
  })
  .strict();

/**
 * **`kind` is chosen once, at creation.** Changing a `short_text` into a
 * `multiple_choice` would leave an answer that answers a different question, so
 * the patch schema below does not accept it — a new question is a new question.
 */
export const questionSchema = z
  .object({
    kind: z.enum(['short_text', 'long_text', 'single_choice', 'multiple_choice']),
    prompt: z.string().trim().min(1).max(1000),
    /** Only meaningful on a choice question; the service refuses it elsewhere. */
    justification: z.enum(['none', 'optional', 'required']).optional(),
    options: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict();

export const questionPatchSchema = z
  .object({
    version: z.coerce.number().int().min(0),
    prompt: z.string().trim().min(1).max(1000).optional(),
    justification: z.enum(['none', 'optional', 'required']).optional(),
    /** The whole set, replaced. A partial edit of options has no meaning: their
     *  order is part of what the student saw. */
    options: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict();

export const reorderQuestionsSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(200) })
  .strict();

/**
 * **A student's answers.**
 *
 * `student_id` is deliberately absent: the subject is the JWT `sub`, so there
 * is nowhere for a caller to name somebody else — the same structural rule
 * R123's self check-in uses, and the reason the service's own check is a
 * backstop rather than the mechanism.
 */
export const responsesSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            question_id: z.uuid(),
            text: z.string().max(5000).nullable().optional(),
            justification: z.string().max(2000).nullable().optional(),
            option_ids: z.array(z.uuid()).max(20).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

/**
 * **R125 — the target picker's query.**
 *
 * `kind` is required: *which of the five am I choosing* has no sensible default,
 * and a default would make an omitted parameter mean something.
 */
export const targetCandidatesSchema = z
  .object({
    kind: z.enum(['level', 'administrative_group', 'session', 'teaching_group', 'student']),
    /** Narrows the offer to one Level where the arm has one. Never widens it. */
    level_id: z.uuid().optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * **`GET /assessments` — the library's query.**
 *
 * **Every parameter is optional**, which is rule A's API half: a management
 * screen shows the data it manages the moment it opens, and a filter narrows
 * what is visible rather than being the precondition for anything appearing.
 * `.strict()` so a misspelled filter is refused rather than silently ignored,
 * which would render as *«no results»* and read as an empty library.
 */
export const assessmentListSchema = z
  .object({
    status: z.enum(['draft', 'published', 'closed']).optional(),
    level_id: z.uuid().optional(),
    subject_id: z.uuid().optional(),
    academic_year_id: z.uuid().optional(),
    /** Title contains, case-insensitive. */
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

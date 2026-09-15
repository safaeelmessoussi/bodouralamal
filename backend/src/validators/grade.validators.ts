import { z } from 'zod';

import { uuid, version } from './common.js';

/**
 * The grade write boundary (§4.6, BR-7; SRS Revision 81).
 *
 * **A score crosses the wire as itself** — 15 for an exam whose maximum is 20 —
 * because that is how it is stored. R70's basis-point conversion is gone with
 * the platform-wide scale that required it, and with it the rounding site that
 * decided whether a mark read back as the one somebody typed.
 *
 * **The ceiling here is the column's, not the exam's.** A schema cannot know
 * which exam the request is for, so it refuses what could never be stored and
 * leaves *is this within THIS exam's maximum* to the service, which has the exam
 * in hand. Two decimals for the same reason: a third would be rounded by the
 * column and read back as something else.
 *
 * **`score: null` is not the same as `score: 0`**, and the schema keeps them
 * apart: `null` leaves a student unmarked and BR-7 makes them absent-zero at the
 * save; `0` is somebody deciding the student scored nothing.
 */
const score = z
  .number()
  .min(0, 'a score cannot be negative')
  .max(9999.99, 'a score cannot exceed the column range')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: 'at most two decimal places',
  });

export const saveGradesSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            student_id: uuid,
            /** `null` — unmarked. BR-7 turns it into an absent-zero on save. */
            score: score.nullable(),
            absent: z.boolean().default(false),
            /** TD-15 — omitted for a student who has no row yet. */
            version: version.optional(),
            /**
             * **Owner-reported, 2026-09-15 — per-question grading, where the
             * exam uses R137's points.** Present, this REPLACES `score`
             * above; the service computes and stores the sum, and refuses
             * an exam that does not use points at all. Each entry's own
             * bound (against ITS question's own points, never the exam's
             * maximum) is checked in the service, which alone knows it.
             */
            question_scores: z
              .array(
                z.object({ question_id: uuid, score }).strict(),
              )
              .max(200)
              .optional(),
          })
          .strict()
          // An absent student holds a real 0 (BR-7); accepting a mark beside
          // the flag would leave two answers on one row and no rule for which
          // of them is the student's result.
          .refine((e) => !(e.absent && e.score !== null && e.score > 0), {
            message: 'an absent student cannot also hold a score',
            path: ['score'],
          })
          // Same rule, restated for the breakdown: absent means nothing was
          // sat, and a per-question score is a fact about an answer that
          // was, so the two are exactly as contradictory as `score` above.
          .refine((e) => !(e.absent && (e.question_scores?.length ?? 0) > 0), {
            message: 'an absent student cannot also hold per-question scores',
            path: ['question_scores'],
          }),
      )
      .max(500),
  })
  .strict();


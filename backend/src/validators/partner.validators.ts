import { z } from 'zod';

import { displayOrder, version } from './common.js';

/**
 * Partners (NEW N) — the write boundary.
 *
 * `name` has its own limit rather than reusing `entityName`'s 120: a partner is
 * an organisation, and organisations have long formal names. 200 matches the
 * column, and the two are meant to agree — §16.2 puts TD-9's limits in Zod, and
 * a Zod limit looser than the column would surface as a database error instead
 * of a `400`.
 */
const partnerName = z.string().trim().min(1).max(200);

/**
 * A sentence under a name on a public page, not a page of its own — 500 to match
 * the column. **`''` normalises to `null`**, because *no description* is one
 * state and not two: a form that clears the field sends `''`, and storing that
 * beside `null` would make «has a description» two different checks forever.
 */
const partnerDescription = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((v) => (v === '' ? null : v));

export const createPartnerSchema = z
  .object({
    name: partnerName,
    description: partnerDescription.optional(),
    display_order: displayOrder.optional(),
    is_visible: z.boolean().optional(),
  })
  .strict();

export const updatePartnerSchema = z
  .object({
    version,
    name: partnerName.optional(),
    description: partnerDescription.optional(),
    display_order: displayOrder.optional(),
    is_visible: z.boolean().optional(),
  })
  .strict();

import { z } from 'zod';

import { uuid } from './common.js';

/**
 * `GET /library` filters (TD-3.13).
 *
 * **The filter set is identical for anonymous and authenticated callers** (§5.2,
 * SRS line 53) — there is no signed-in-only filter, and adding one would make
 * navigation differ by audience, which is exactly what the clause forbids.
 *
 * Not `.strict()`: TD-10's `page`/`page_size` share the query object.
 */
export const listLibraryQuerySchema = z.object({
  category_id: uuid.optional(),
  level_id: uuid.optional(),
  academic_year_id: uuid.optional(),
  subject_id: uuid.optional(),
  // R76 — validated against the endpoint's own allow-list in the service, which
  // refuses an unknown field rather than ignoring it.
  sort_by: z.string().optional(),
  sort_dir: z.string().optional(),
});

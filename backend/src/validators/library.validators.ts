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
  /** R177 §7 — items about one Surah; R223 — `none`, the items about none. */
  surah_id: z.union([z.literal('none'), z.coerce.number().int().min(1).max(114)]).optional(),
  /** R223 — a branch's items, Global ones included (every branch's). */
  branch_id: uuid.optional(),
  /** R242 — «صاحب المحتوى»: one person's items; `none`, the items with nobody named. */
  author_id: z.union([z.literal('none'), uuid]).optional(),
  // R167 §5 — «كل مستويات الفئة»: only the items addressed to every Level of
  // their Category (`true`), or only those that are not (`false`).
  whole_category: z.enum(['true', 'false']).optional(),
  /** R250 — «النوع», as the screens name a file: pdf, audio, video, image, or any other document. */
  kind: z.enum(['pdf', 'audio', 'video', 'image', 'document']).optional(),
  // R76 — validated against the endpoint's own allow-list in the service, which
  // refuses an unknown field rather than ignoring it.
  sort_by: z.string().optional(),
  sort_dir: z.string().optional(),
});

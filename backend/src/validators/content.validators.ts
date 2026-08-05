import { z } from 'zod';

import { uuid } from './common.js';

/**
 * TD-3.5 upload boundary (§4.9, TD-9).
 *
 * **The MIME whitelist is not restated here.** `lib/file-types.ts` owns it and
 * the service checks against it, so a type accepted by the schema and refused by
 * the sniffer is impossible by construction. A Zod enum of the same eleven
 * strings would be a second copy of a normative list, and the copy that drifts
 * still passes its own tests.
 */

/** TD-9: a filename long enough to be meaningful, bounded like any name column. */
const filename = z.string().trim().min(1).max(255);

/** §7: `title` is `VarChar(120)`, `description` `VarChar(2000)` (TD-9). */
const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(2000).nullable().optional();

/**
 * `branch_id` is **required and explicitly nullable**, never merely optional.
 * `null` is the Global scope (§4.9) — a real, authorization-relevant value that
 * only an Admin may choose — and an *absent* key would make "Global" the silent
 * default for a Teacher who simply forgot the field.
 */
export const initiateUploadSchema = z
  .object({
    filename,
    size: z.number().int().positive(),
    mime: z.string().trim().min(1).max(120),
    content_meta: z
      .object({
        level_id: uuid,
        subject_id: uuid,
        academic_year_id: uuid,
        branch_id: uuid.nullable(),
        visibility: z.enum(['public', 'private', 'hidden']).optional(),
        /** TD-9 replacement: a new key for an existing record, never an overwrite. */
        replaces_content_id: uuid.optional(),
      })
      .strict(),
  })
  .strict();

/**
 * Completion carries only what no authorization decision depends on.
 *
 * Everything else — the scope, the type, the size, the key — is bound into the
 * upload ticket at `/initiate` and is not accepted from the body, for the same
 * reason §4.1b refuses an email from the registration body: a field the server
 * already decided must not be re-openable by the client.
 */
export const completeUploadSchema = z.object({ title, description }).strict();

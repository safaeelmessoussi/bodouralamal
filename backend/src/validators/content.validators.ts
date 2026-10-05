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
 * `branch_id` (or, since R198 §2, `branch_ids`) is **required**: one of the two
 * must be named, and `null` / `[]` is stated, never defaulted.
 * `null` is the Global scope (§4.9) — a real, authorization-relevant value that
 * only an Admin may choose — and an *absent* key would make "Global" the silent
 * default for a Teacher who simply forgot the field.
 */
export const initiateUploadSchema = z
  .object({
    filename,
    size: z.number().int().positive(),
    // R200 — may be empty: a file the browser could not type is read by its
    // extension (`canonicalUploadMime`), and its bytes are checked at completion.
    mime: z.string().trim().max(120),
    content_meta: z
      .object({
        /**
         * **R172 §1 — a Level, or a whole Category.** Exactly one of the two:
         * `category_id` files the item for EVERY Level of that Category
         * (R167 §5's `whole_category`) with no Level chosen — the server picks
         * the Category's first Level as where it is filed, exactly as the
         * recording ingest does for a class addressed to a whole Category.
         */
        level_id: uuid.optional(),
        category_id: uuid.optional(),
        /** R195 — `null` is «عام» (TD-5's General): material of a class that
         *  teaches ALL its Level's Subjects. Required and explicitly nullable,
         *  for the same reason `branch_id` is: the choice is made, never
         *  skipped. */
        subject_id: uuid.nullable(),
        academic_year_id: uuid,
        branch_id: uuid.nullable().optional(),
        /**
         * **R198 §2 — the branches the item is filed for**; `[]` is Global
         * (§4.9), as `branch_id: null` is. The first is its home branch. Name
         * exactly one of `branch_id` and `branch_ids`, so Global is still a
         * choice stated, never a key forgotten.
         */
        branch_ids: z
          .array(uuid)
          .max(40)
          .refine((ids) => new Set(ids).size === ids.length, 'a branch may be named once')
          .optional(),
        visibility: z.enum(['public', 'private', 'hidden']).optional(),
        /**
         * **R99.12 — the upload boundary must be able to say *this is a class
         * recording*.**
         *
         * R99.10 makes «التسجيلات» a function of `origin` rather than of the
         * MIME type. §4.9's MVP flow is a مؤطِّرة recording on her phone and
         * uploading the file, so without this field every such recording would
         * become a *material* the day origin-based classification shipped — a
         * regression dressed as a refinement.
         *
         * It states what the thing IS; it grants nothing. **`video/*` is still
         * refused here whatever this says** — TD-9's video row is reachable only
         * by the platform's own ingestion pipeline (R99.8), and the whitelist
         * check does not consult this field.
         */
        origin: z.enum(['uploaded', 'session_recording']).optional(),
        /** R177 §7 — the one Surah this item is about (1–114), or none. */
        surah_id: z.number().int().min(1).max(114).nullable().optional(),
        /** TD-9 replacement: a new key for an existing record, never an overwrite. */
        replaces_content_id: uuid.optional(),
      })
      .strict()
      .refine((meta) => (meta.level_id === undefined) !== (meta.category_id === undefined), {
        message: 'name exactly one of level_id and category_id',
        path: ['level_id'],
      })
      .refine((meta) => (meta.branch_id === undefined) !== (meta.branch_ids === undefined), {
        message: 'name exactly one of branch_id and branch_ids',
        path: ['branch_ids'],
      }),
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

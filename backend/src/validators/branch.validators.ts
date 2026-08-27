import { z } from 'zod';

import { displayOrder, entityName, uuid, version } from './common.js';

/**
 * Zod schemas for the Branch/Room API boundary (§16.2 — Zod is the single place
 * TD-9 limits are encoded, and validation happens at every API boundary).
 *
 * `entityName`, `displayOrder` and `version` moved to `common.ts` when Revision
 * 43 needed the same TD-9/TD-15 limits for the educational endpoints. They are
 * imported rather than restated: a limit with two homes drifts.
 */

/*
 * TD-9 public branch fields (Revision 35). This is where "required" is
 * enforced: the columns are nullable so branches predating the revision need no
 * invented address, and the write boundary is the only place a real value can
 * actually be demanded.
 */
const address = z.string().trim().min(5).max(300);
const phone = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .regex(/^[0-9+ ]+$/, 'digits, + and spaces only');
const email = z.string().trim().max(254).pipe(z.email()).transform((v) => v.toLowerCase());
/** Multiline, displayed verbatim, never parsed (§7). */
const openingHours = z.string().trim().min(3).max(500);
/**
 * Absolute `https://` only. The value becomes an outbound link on a public
 * page, so a relative or `javascript:` URL here is an injection vector rather
 * than a typo — the database carries the same rule as a backstop (TD-9).
 */
const googleMapsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('https://'), 'must be an absolute https:// URL');

export const createBranchSchema = z.object({
  name: entityName,
  operational_start_date: z.coerce.date().nullable().optional(),
  display_order: displayOrder.optional(),
  // Revision 35 public fields.
  address: address.optional(),
  phone: phone.nullable().optional(),
  /** NEW I — the second number, validated by the SAME rule as the first. A
   *  looser one here would make «which of the two may I dial» depend on which
   *  field it landed in. */
  phone_secondary: phone.nullable().optional(),
  email: email.nullable().optional(),
  opening_hours_ar: openingHours.optional(),
  google_maps_url: googleMapsUrl.nullable().optional(),
});

export const updateBranchSchema = z.object({
  version,
  name: entityName.optional(),
  operational_start_date: z.coerce.date().nullable().optional(),
  display_order: displayOrder.optional(),
  address: address.optional(),
  phone: phone.nullable().optional(),
  /** NEW I — the second number, validated by the SAME rule as the first. A
   *  looser one here would make «which of the two may I dial» depend on which
   *  field it landed in. */
  phone_secondary: phone.nullable().optional(),
  email: email.nullable().optional(),
  opening_hours_ar: openingHours.optional(),
  google_maps_url: googleMapsUrl.nullable().optional(),
});

export const createRoomSchema = z.object({ name: entityName });

export const updateRoomSchema = z.object({ version, name: entityName.optional() });

export const uuidParam = uuid;

import { z } from 'zod';

/**
 * Zod schemas for the Branch/Room API boundary (§16.2 — Zod is the single place
 * TD-9 limits are encoded, and validation happens at every API boundary).
 */

/** TD-9: structural entity `name` max 120 chars, Arabic. */
const entityName = z.string().trim().min(1).max(120);

/** TD-6 CHECK: `display_order >= 0`. Rejected here too, so the caller gets a
 *  `400 VALIDATION_FAILED` rather than a constraint violation surfacing as 500. */
const displayOrder = z.number().int().min(0).nullable();

/** TD-15: every edit form loads the current `version` and sends it back. */
const version = z.coerce.number().int().min(0);

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
  email: email.nullable().optional(),
  opening_hours_ar: openingHours.optional(),
  google_maps_url: googleMapsUrl.nullable().optional(),
});

export const createRoomSchema = z.object({ name: entityName });

export const updateRoomSchema = z.object({ version, name: entityName.optional() });

export const uuidParam = z.uuid();

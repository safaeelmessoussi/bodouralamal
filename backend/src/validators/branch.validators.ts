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

export const createBranchSchema = z.object({
  name: entityName,
  operational_start_date: z.coerce.date().nullable().optional(),
  display_order: displayOrder.optional(),
});

export const updateBranchSchema = z.object({
  version,
  name: entityName.optional(),
  operational_start_date: z.coerce.date().nullable().optional(),
  display_order: displayOrder.optional(),
});

export const createRoomSchema = z.object({ name: entityName });

export const updateRoomSchema = z.object({ version, name: entityName.optional() });

export const uuidParam = z.uuid();

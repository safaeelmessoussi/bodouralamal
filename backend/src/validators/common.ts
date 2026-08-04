import { z } from 'zod';

/**
 * Validator primitives shared across the API boundary (§16.2).
 *
 * **Why these are here and not in each validator module.** TD-9's column limits
 * and TD-15's optimistic-locking field are *normative constants*, and a
 * normative constant with more than one home drifts — the copy that drifts still
 * passes its own tests. `branch.validators.ts` held the only definitions until
 * Revision 43 needed the same four for administrative groups, teaching groups,
 * course schedules and sessions; that is the moment to name them once rather
 * than the moment to copy them a second time.
 */

/** TD-9: a structural entity `name` is 1–120 characters, Arabic. */
export const entityName = z.string().trim().min(1).max(120);

/**
 * TD-6 CHECK: `display_order >= 0`.
 *
 * Rejected here as well as in SQL so the caller receives a
 * `400 VALIDATION_FAILED` rather than a constraint violation surfacing as a 500.
 * Nullable, because *unordered* is a real state (BR-19 falls back to the name).
 */
export const displayOrder = z.number().int().min(0).nullable();

/** TD-15: every edit form loads the current `version` and sends it back. */
export const version = z.coerce.number().int().min(0);

/** A path or query identifier. Malformed input is a `400`, never a lookup. */
export const uuid = z.uuid();

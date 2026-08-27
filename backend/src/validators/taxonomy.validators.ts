import { z } from 'zod';

import { displayOrder, entityDescription, entityName, uuid, version } from './common.js';

/**
 * Zod schemas for the curriculum taxonomy boundary — Categories, Subjects and
 * Levels (§16.2: Zod is the single place TD-9 limits are encoded).
 *
 * The primitives are imported from `common.ts` rather than restated: a
 * normative limit with two homes drifts, and the copy that drifts still passes
 * its own tests.
 */

export const createCategorySchema = z.object({
  name: entityName,
  description: entityDescription.optional(),
  display_order: displayOrder.optional(),
});

export const updateCategorySchema = z.object({
  version,
  name: entityName.optional(),
  description: entityDescription.optional(),
  display_order: displayOrder.optional(),
});

export const createSubjectSchema = z.object({
  name: entityName,
  display_order: displayOrder.optional(),
});

export const updateSubjectSchema = z.object({
  version,
  name: entityName.optional(),
  display_order: displayOrder.optional(),
});

/**
 * §4.4b / Revision 27 — who a Level admits, as a value a query can read rather
 * than an implication of its Arabic name. Mirrors the `GenderRestriction`
 * database enum; a value outside it is a `400`, never a constraint violation
 * surfacing as a 500.
 */
const genderRestriction = z.enum(['any', 'girls_only', 'boys_only']);

/**
 * `branch_id` is **required** and is not a column on `Level` (TD-4.6b,
 * Revision 43.1): it says where المجموعة 1 goes. A Level stays Category-scoped
 * and branch-independent — see `level.service.ts` for why putting a branch on
 * the Level itself would break `entire_level` teaching mode.
 */
/**
 * **No `branch_id` (Revision 66).** A Level belongs to a Category and to no
 * Branch; the field existed because creation also made a first Administrative
 * Group, and TD-4.6b is retired. A branch is chosen when a Level is actually
 * subdivided — on the group, where it belongs.
 */
export const createLevelSchema = z
  .object({
    name: entityName,
    description: entityDescription.optional(),
    category_id: uuid,
    gender_restriction: genderRestriction.default('any'),
    display_order: displayOrder.optional(),
  })
  // **`.strict()`, and for the reason the update schema already is:** stripping
  // `branch_id` would let a client send one, receive `201`, and believe a group
  // had been created at that branch. The field does not exist on this operation
  // at all, so refusing it loudly is the honest answer.
  .strict();

/**
 * `category_id` is absent deliberately — a Level does not move between
 * Categories. The service docstring records why.
 *
 * **`.strict()`, and only here.** Stripping the unknown key would let a client
 * send `category_id`, receive `200`, and believe the Level moved. The field does
 * not exist on this operation at all, so refusing it loudly is the honest
 * answer; strictness is not applied to the other schemas, where an unknown key
 * is a client's own extra baggage rather than a request the server appears to
 * have honoured.
 */
export const updateLevelSchema = z
  .object({
    version,
    name: entityName.optional(),
    description: entityDescription.optional(),
    gender_restriction: genderRestriction.optional(),
    display_order: displayOrder.optional(),
  })
  .strict();

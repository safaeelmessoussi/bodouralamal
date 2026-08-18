import { z } from 'zod';

import { uuid } from './common.js';

/**
 * The reorder body (SRS Proposal R76.4) — **one schema for every orderable
 * resource**, because the contract is deliberately identical across them.
 *
 * `{ ids: [...] }` is **the sequence**, not a list of positions: the server
 * assigns `display_order` from each id's index, so duplicate and gapped values
 * are impossible rather than validated against.
 *
 * **The set rules are NOT here.** Whether the sequence is the exact live set —
 * no duplicates, none missing, none foreign — depends on the resource and on the
 * caller's scope, so it is checked in the transaction that writes it
 * (`assertExactSet`), where the read cannot be stale. This schema checks only
 * that the request is *shaped* like a sequence of ids.
 *
 * `.strict()` because a reorder that also carried, say, a `version` would be
 * proposing a concurrency model this contract deliberately does not use.
 */
export const reorderSchema = z
  .object({
    // An empty array is valid: reordering an empty collection is a no-op, and
    // refusing it would make a client special-case the empty case for nothing.
    ids: z.array(uuid).max(500),
  })
  .strict();

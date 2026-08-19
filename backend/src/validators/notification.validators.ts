import { z } from 'zod';

/**
 * The optional-send boundary (R82.5).
 *
 * **The client names the KIND of change and nothing else.** There is no
 * recipient list to send and therefore none to forge: the audience is resolved
 * server-side from the event's own scope rows, which is the property R82.7
 * states. A body that could carry user ids would need a permission check per id;
 * one that cannot, needs none.
 *
 * `.strict()`, so a recipient array added by a hopeful client is **refused**
 * rather than ignored — a caller learns its assumption is wrong instead of
 * watching a silent no-op.
 */
export const notifyEventSchema = z
  .object({
    change: z.enum(['created', 'rescheduled', 'cancelled']),
  })
  .strict();

/**
 * The occurrence's equivalent (R83.3).
 *
 * Only the two changes a Session announces: `session_assigned` is written by the
 * staffing path itself and `session_restored` by R77.5's reconciliation, neither
 * of which is a decision somebody takes on a form.
 */
export const notifySessionSchema = z
  .object({
    change: z.enum(['cancelled', 'rescheduled']),
  })
  .strict();

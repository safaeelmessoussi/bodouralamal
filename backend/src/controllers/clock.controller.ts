import type { Request, Response } from 'express';

import { clockStatus } from '../lib/morocco-clock.js';

/**
 * `GET /clock` — **what time it is in Morocco, as THIS platform knows it** (SRS
 * Revision 167 §2). Public and tiny: a browser formats every instant it shows
 * with the offset this answers, so a phone whose own zone data predates the
 * latest decree still shows the association's clock. `next_change_at` tells it
 * when to ask again. No caller, no data about anybody — nothing to authorize.
 */
export function read() {
  return (_req: Request, res: Response): void => {
    const status = clockStatus();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      data: {
        now: new Date().toISOString(),
        zone: 'Africa/Casablanca',
        utc_offset_minutes: status.utc_offset_minutes,
        in_force_since: status.in_force_since,
        next_change_at: status.next_change_at,
        // Said, so a stale answer is visible rather than merely wrong.
        source: status.source,
      },
    });
  };
}

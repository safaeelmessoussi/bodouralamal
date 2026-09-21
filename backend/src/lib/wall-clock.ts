import { moroccoWallClockToInstant } from './morocco-clock.js';

/** TD-11: SQL date/time values become an instant only on the server's
 * Africa/Casablanca clock (TZ is pinned by the runtime). Never Date.UTC. */
export function wallClockInstant(date: Date, time: Date): Date {
  // **Through `morocco-clock`, never `new Date(y, m, d, …)`** (R167 §2): that
  // constructor converts with the zone data compiled into Node, which a
  // container image freezes. On 2026-09-20 Morocco moved to UTC+0 and every
  // exam opening computed here was an hour early until this line changed.
  return moroccoWallClockToInstant(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    time.getUTCHours(),
    time.getUTCMinutes(),
    time.getUTCSeconds(),
  );
}

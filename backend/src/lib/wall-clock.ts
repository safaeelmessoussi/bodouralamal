/** TD-11: SQL date/time values become an instant only on the server's
 * Africa/Casablanca clock (TZ is pinned by the runtime). Never Date.UTC. */
export function wallClockInstant(date: Date, time: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds());
}

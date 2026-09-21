import { api } from './api.js';

/**
 * **Every instant on screen is shown in Morocco's time, as the SERVER knows it**
 * (SRS Revision 167 §2).
 *
 * `new Date(x).toLocaleString('ar-MA')` shows the DEVICE's zone with the
 * device's own zone data — a مستفيدة abroad read her log times in another
 * country's clock, and a phone that has not been updated since the last decree
 * is an hour off in Morocco itself. The platform follows the host's zone
 * database; `GET /clock` says what it answers, and this formats with that.
 *
 * Until the answer arrives (and if it never does) the fallback is the browser's
 * own `Africa/Casablanca` — right on any updated device, and never the device's
 * own zone.
 *
 * **Dates and class times never come through here**: they are zone-free strings
 * by design (TD-11) and are rendered as sent.
 */
export const MOROCCO_ZONE = 'Africa/Casablanca';

interface Clock {
  utcOffsetMinutes: number;
  /** Since when this offset has been in force; `null` when unknown (then: always). */
  inForceSince: number | null;
  /** When the offset is known to change next; `null` when none is known. */
  nextChangeAt: number | null;
}

let clock: Clock | null = null;
let pending: Promise<void> | null = null;

/** Asked once per page load, and again once a known change has passed. */
export function loadMoroccoClock(): Promise<void> {
  const expired = clock?.nextChangeAt != null && Date.now() >= clock.nextChangeAt;
  if ((clock !== null && !expired) || pending !== null) return pending ?? Promise.resolve();
  pending = api<{
    data: {
      utc_offset_minutes: number;
      in_force_since?: string | null;
      next_change_at: string | null;
    };
  }>('/clock', { token: null })
    .then((body) => {
      clock = {
        utcOffsetMinutes: body.data.utc_offset_minutes,
        inForceSince: body.data.in_force_since ? Date.parse(body.data.in_force_since) : null,
        nextChangeAt: body.data.next_change_at ? Date.parse(body.data.next_change_at) : null,
      };
    })
    .catch(() => {
      // The fallback below is already correct on an updated device.
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export type InstantStyle = 'date' | 'datetime';

/**
 * An instant, in Morocco's time. With the server's offset the instant is shifted
 * and formatted as UTC, so the DEVICE's zone data is never consulted for any
 * instant the server's offset covers.
 */
export function formatInstant(
  value: string | Date,
  style: InstantStyle = 'datetime',
  locale = 'ar-MA',
): string {
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return '';
  const options: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { dateStyle: 'medium' }
      : { dateStyle: 'medium', timeStyle: 'short' };

  // The server's offset holds between the last change and the next one. An
  // instant from BEFORE the last change needs the older offset — and old rules
  // are exactly what an outdated device still knows, so the fallback is right.
  const at = instant.getTime();
  const inForce =
    clock !== null &&
    (clock.inForceSince === null || at >= clock.inForceSince) &&
    (clock.nextChangeAt === null || at < clock.nextChangeAt);
  if (clock !== null && inForce) {
    const shifted = new Date(instant.getTime() + clock.utcOffsetMinutes * 60_000);
    return shifted.toLocaleString(locale, { ...options, timeZone: 'UTC' });
  }
  return instant.toLocaleString(locale, { ...options, timeZone: MOROCCO_ZONE });
}

/** Tests only. */
export function setMoroccoClockForTests(next: Clock | null): void {
  clock = next;
  pending = null;
}

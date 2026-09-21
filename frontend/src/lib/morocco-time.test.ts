import { afterEach, describe, expect, it } from 'vitest';

import { formatInstant, setMoroccoClockForTests } from './morocco-time.js';

/**
 * SRS Revision 167 §2 — an instant is shown in Morocco's time AS THE SERVER
 * KNOWS IT. The case that matters is the device whose own zone data predates
 * the latest decree: simulated here by an offset that contradicts whatever this
 * machine believes, and asserting the SERVER's wins.
 */
afterEach(() => setMoroccoClockForTests(null));

const hourOf = (text: string): string => text.match(/(\d{1,2}):(\d{2})/u)?.[0] ?? text;

describe('formatInstant', () => {
  const instant = '2026-09-21T09:46:00.000Z';

  it('uses the server’s offset, whatever the device believes', () => {
    setMoroccoClockForTests({ utcOffsetMinutes: 0, inForceSince: Date.parse('2026-09-20T01:00:00Z'), nextChangeAt: null });
    expect(hourOf(formatInstant(instant, 'datetime', 'en-GB'))).toBe('09:46');
    // Were Morocco to move again, the same instant follows at once.
    setMoroccoClockForTests({ utcOffsetMinutes: 60, inForceSince: Date.parse('2026-09-20T01:00:00Z'), nextChangeAt: null });
    expect(hourOf(formatInstant(instant, 'datetime', 'en-GB'))).toBe('10:46');
  });

  it('does not apply today’s offset to an instant from BEFORE the last change', () => {
    setMoroccoClockForTests({ utcOffsetMinutes: 0, inForceSince: Date.parse('2026-09-20T01:00:00Z'), nextChangeAt: null });
    // June 2026 was UTC+1 under every published rule set: 12:00Z reads 13:00.
    expect(hourOf(formatInstant('2026-06-10T12:00:00.000Z', 'datetime', 'en-GB'))).toBe('13:00');
  });

  it('nor to one beyond the next known change', () => {
    setMoroccoClockForTests({ utcOffsetMinutes: 0, inForceSince: null, nextChangeAt: Date.parse('2026-09-21T09:00:00Z') });
    const beyond = formatInstant(instant, 'datetime', 'en-GB');
    // Falls back to the browser's own Africa/Casablanca — never the raw offset.
    expect(beyond).toBe(new Date(instant).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Casablanca' }));
  });

  it('never shows the DEVICE’s own zone, even before the server has answered', () => {
    expect(formatInstant(instant, 'datetime', 'en-GB')).toBe(
      new Date(instant).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Casablanca' }),
    );
  });

  it('an unparsable value is empty, not «Invalid Date»', () => {
    expect(formatInstant('not a date')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { occurrenceHref, readOccurrenceAddress } from './occurrence-link.js';
import { resolveRoute } from './route.js';

describe('the calendar is the occurrence address', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const kind of ['session', 'event', 'exam'] as const) {
    it(`round-trips ${kind} including the recurrence date on refresh`, () => {
      const occurrence = { kind, id, date: '2026-09-07' };
      const url = new URL(occurrenceHref(occurrence), 'https://example.invalid');
      expect(resolveRoute(url.pathname)).toBe('calendar');
      expect(readOccurrenceAddress(url.search)).toEqual(occurrence);
    });
  }
  it('refuses malformed, missing and impossible coordinates', () => {
    for (const search of ['', `?occurrence=session:${id}`, `?occurrence=other:${id}&date=2026-09-07`, `?occurrence=session:${id}&date=2026-02-30`, '?occurrence=session:abc&date=2026-09-07']) {
      expect(readOccurrenceAddress(search)).toBeNull();
    }
  });
  it('has no dedicated detail route, but preserves the live classroom', () => {
    expect(resolveRoute(`/calendar/sessions/${id}`)).toBe('not-found');
    expect(resolveRoute(`/classroom/${id}`)).toBe('classroom');
  });
});

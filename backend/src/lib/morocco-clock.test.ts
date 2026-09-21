import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { offsetChangesAround, offsetFromRules, parseTzif } from './morocco-clock.js';

/**
 * SRS Revision 167 §2 — the platform follows Morocco's official time from the
 * HOST's zone database. These hold the two halves a wrong hour hides in: the
 * file is read correctly, and the right row of it is chosen.
 */

/** A minimal, valid version-2 TZif: an empty 32-bit block, then a 64-bit block
 *  with the given transitions. Built here so the test depends on no machine. */
function tzif(transitions: { at: string; offsetMinutes: number }[], initialOffsetMinutes: number): Uint8Array {
  const offsets = [initialOffsetMinutes, ...transitions.map((t) => t.offsetMinutes)];
  const types = [...new Set(offsets)];
  const header = (timecnt: number, typecnt: number, charcnt: number): Uint8Array => {
    const h = new Uint8Array(44);
    h.set([0x54, 0x5a, 0x69, 0x66, 0x32]); // "TZif2"
    const v = new DataView(h.buffer);
    v.setUint32(32, timecnt);
    v.setUint32(36, typecnt);
    v.setUint32(40, charcnt);
    return h;
  };
  // v1 block: no times, one type, one abbreviation byte — what a "slim" file has.
  const v1 = new Uint8Array(44 + 6 + 1);
  v1.set(header(0, 1, 1));
  const body = new Uint8Array(transitions.length * 9 + types.length * 6 + 1);
  const view = new DataView(body.buffer);
  transitions.forEach((t, i) => view.setBigInt64(i * 8, BigInt(Date.parse(t.at) / 1000)));
  transitions.forEach((t, i) => {
    body[transitions.length * 8 + i] = types.indexOf(t.offsetMinutes);
  });
  // Type 0 must be the initial one (RFC 8536 §3.2), so it is listed first.
  const ordered = [initialOffsetMinutes, ...types.filter((x) => x !== initialOffsetMinutes)];
  transitions.forEach((t, i) => {
    body[transitions.length * 8 + i] = ordered.indexOf(t.offsetMinutes);
  });
  ordered.forEach((minutes, i) => view.setInt32(transitions.length * 9 + i * 6, minutes * 60));
  const v2 = new Uint8Array(44 + body.length);
  v2.set(header(transitions.length, ordered.length, 1));
  v2.set(body, 44);
  const out = new Uint8Array(v1.length + v2.length);
  out.set(v1);
  out.set(v2, v1.length);
  return out;
}

describe('what `GET /clock` says about change', () => {
  // As the real file is after 2026c: the change, then a transition that changes
  // NOTHING (`zic` writes one at the 32-bit limit).
  const rules = parseTzif(
    tzif(
      [
        { at: '2026-03-22T02:00:00Z', offsetMinutes: 60 },
        { at: '2026-09-20T01:00:00Z', offsetMinutes: 0 },
        { at: '2038-01-19T03:14:07Z', offsetMinutes: 0 },
      ],
      0,
    ),
  );
  const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

  it('a transition that leaves the offset as it was is not a change — a browser must not be told to expect one', () => {
    const now = offsetChangesAround(rules, Date.parse('2026-09-21T10:00:00Z'));
    expect(iso(now.since)).toBe('2026-09-20T01:00:00.000Z');
    expect(now.next).toBeNull();
    // …and after it, the offset has STILL been in force since the real change.
    expect(iso(offsetChangesAround(rules, Date.parse('2040-01-01T00:00:00Z')).since)).toBe(
      '2026-09-20T01:00:00.000Z',
    );
  });

  it('a real change is announced, so a browser refreshes in time', () => {
    const summer = offsetChangesAround(rules, Date.parse('2026-06-01T00:00:00Z'));
    expect(iso(summer.since)).toBe('2026-03-22T02:00:00.000Z');
    expect(iso(summer.next)).toBe('2026-09-20T01:00:00.000Z');
  });
});

describe('reading a zone file', () => {
  const rules = parseTzif(
    tzif(
      [
        { at: '2026-02-15T02:00:00Z', offsetMinutes: 0 },
        { at: '2026-03-22T02:00:00Z', offsetMinutes: 60 },
        { at: '2026-09-20T01:00:00Z', offsetMinutes: 0 },
      ],
      60,
    ),
  );

  it('reads the 64-bit block of a slim file, in minutes east of UTC', () => {
    expect(rules.transitions.map((t) => new Date(t).toISOString())).toEqual([
      '2026-02-15T02:00:00.000Z',
      '2026-03-22T02:00:00.000Z',
      '2026-09-20T01:00:00.000Z',
    ]);
    expect(rules.offsets).toEqual([0, 60, 0]);
    expect(rules.initialOffset).toBe(60);
  });

  it('answers with the offset in force AT the instant — before, between and after every change', () => {
    const at = (iso: string): number => offsetFromRules(rules, Date.parse(iso));
    expect(at('2026-01-10T12:00:00Z')).toBe(60);
    expect(at('2026-02-15T01:59:59Z')).toBe(60);
    expect(at('2026-02-15T02:00:00Z')).toBe(0);
    expect(at('2026-03-01T12:00:00Z')).toBe(0);
    expect(at('2026-06-01T12:00:00Z')).toBe(60);
    // The change this module exists for: Sunday 20 September 2026.
    expect(at('2026-09-20T00:59:59Z')).toBe(60);
    expect(at('2026-09-20T01:00:00Z')).toBe(0);
    expect(at('2026-09-21T09:46:00Z')).toBe(0);
  });

  it('refuses a file that is not TZif rather than answering from garbage', () => {
    expect(() => parseTzif(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow('not a TZif file');
  });
});

describe('this machine’s own Africa/Casablanca', () => {
  const file = '/usr/share/zoneinfo/Africa/Casablanca';

  it.skipIf(!existsSync(file))('parses, and only ever says UTC+0 or UTC+1 for this century', () => {
    const rules = parseTzif(readFileSync(file));
    expect(rules.transitions.length).toBeGreaterThan(50);
    const recent = rules.offsets.filter((_, i) => rules.transitions[i]! > Date.parse('2019-01-01T00:00:00Z'));
    expect(new Set(recent)).toEqual(new Set([0, 60]));
    // Ascending, or the binary search is meaningless.
    expect([...rules.transitions].sort((a, b) => a - b)).toEqual(rules.transitions);
  });
});

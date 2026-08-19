import { describe, expect, it } from 'vitest';

import { conflictsWith, firstOverlap, isWithinAvailability, overlaps } from './teaching-profile.js';

const range = (weekday: string, start: string, end: string) => ({ weekday, start, end });

/**
 * The planning rules, exhaustively — they are pure functions precisely so this
 * needs no database and no clock, and so the boundaries can be stated rather
 * than sampled.
 */
describe('availability covers a class only when ONE range contains it (R88 §8)', () => {
  const declared = [range('thursday', '15:00', '18:00')];

  it('accepts a class strictly inside the range', () => {
    expect(isWithinAvailability(range('thursday', '15:30', '17:00'), declared)).toBe(true);
  });

  it('accepts a class filling the range exactly — the boundaries are inclusive', () => {
    expect(isWithinAvailability(range('thursday', '15:00', '18:00'), declared)).toBe(true);
  });

  it('REFUSES a class that starts before she is available', () => {
    // *Partly available* is not available: a planner told «matches» for a class
    // beginning half an hour before she arrives has been told something false.
    expect(isWithinAvailability(range('thursday', '14:30', '16:00'), declared)).toBe(false);
  });

  it('refuses a class that runs past the end', () => {
    expect(isWithinAvailability(range('thursday', '17:00', '19:00'), declared)).toBe(false);
  });

  it('refuses the same hours on a different day', () => {
    expect(isWithinAvailability(range('monday', '15:30', '17:00'), declared)).toBe(false);
  });

  it('does NOT merge two touching ranges to cover a class spanning both', () => {
    // 09:00–12:00 and 12:00–15:00 do not together cover 11:00–13:00. Reading
    // them as one would invent an availability nobody declared; a teacher free
    // straight through says so with a single range.
    const two = [range('monday', '09:00', '12:00'), range('monday', '12:00', '15:00')];
    expect(isWithinAvailability(range('monday', '11:00', '13:00'), two)).toBe(false);
    expect(isWithinAvailability(range('monday', '09:30', '11:30'), two)).toBe(true);
  });

  it('matches nothing when she has declared nothing', () => {
    expect(isWithinAvailability(range('monday', '09:00', '10:00'), [])).toBe(false);
  });
});

describe('overlap: touching is allowed, true overlap is not', () => {
  it('treats exactly touching ranges as NOT overlapping', () => {
    expect(overlaps(range('monday', '09:00', '12:00'), range('monday', '12:00', '15:00'))).toBe(
      false,
    );
  });

  it('detects a genuine overlap', () => {
    expect(overlaps(range('monday', '09:00', '12:00'), range('monday', '11:00', '13:00'))).toBe(
      true,
    );
  });

  it('ignores ranges on different days', () => {
    expect(overlaps(range('monday', '09:00', '12:00'), range('tuesday', '09:00', '12:00'))).toBe(
      false,
    );
  });

  it('names the first clashing pair so a refusal can say which', () => {
    const found = firstOverlap([
      range('monday', '09:00', '12:00'),
      range('tuesday', '09:00', '12:00'),
      range('monday', '11:00', '13:00'),
    ]);
    expect(found).not.toBeNull();
    expect(found![0].start).toBe('09:00');
    expect(found![1].start).toBe('11:00');
  });

  it('finds nothing in a clean set', () => {
    expect(
      firstOverlap([range('monday', '09:00', '12:00'), range('monday', '12:00', '15:00')]),
    ).toBeNull();
  });
});

describe('an assignment conflict is a TIME overlap, not merely other work', () => {
  it('does not call a second assignment at another hour a conflict', () => {
    // One مؤطِّرة legitimately teaches across branches, levels and subjects
    // (R87 §F); holding another assignment is not a clash.
    expect(
      conflictsWith(range('thursday', '15:00', '18:00'), [range('thursday', '09:00', '11:00')]),
    ).toEqual([]);
  });

  it('reports the overlapping assignment', () => {
    const clashes = conflictsWith(range('thursday', '15:00', '18:00'), [
      range('thursday', '16:00', '17:00'),
    ]);
    expect(clashes).toHaveLength(1);
  });
});

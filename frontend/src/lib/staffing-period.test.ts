import { describe, expect, it } from 'vitest';

import {
  periodEndsBeforeItStarts,
  periodOutsideSchedule,
  rangesOverlap,
} from './staffing-period.js';

/**
 * **The Owner's case, and the boundary either side of it** (2026-08-29).
 *
 * A schedule beginning 30 غشت 2026 with an assignment of 29 غشت → 29 غشت is
 * refused by the server as `STAFF_PERIOD_OUTSIDE_SCHEDULE`. That refusal is
 * correct and stays; what was wrong is that it arrived only on Save, naming no
 * field. These pin the client-side mirror against the same cases the backend
 * policy uses, so the two cannot drift apart unnoticed.
 */
describe('periodOutsideSchedule', () => {
  const schedule = { from: '2026-08-30', until: '' };

  it('marks the reported case — one day, ending the day before the class starts', () => {
    expect(periodOutsideSchedule({ from: '2026-08-29', until: '2026-08-29' }, schedule)).toBe(true);
  });

  it('accepts the very first day, which is inside by one day', () => {
    // The boundary is inclusive on both sides — `aFrom <= bUntil`, exactly as
    // `intervalsOverlap` has it. Off by one here would refuse a legitimate
    // assignment on the day the class begins.
    expect(periodOutsideSchedule({ from: '2026-08-30', until: '2026-08-30' }, schedule)).toBe(false);
  });

  it('accepts a period that STARTS before the class and runs into it', () => {
    // The rule is overlap, not containment: an assignment already in force when
    // the class begins is ordinary, and refusing it would be a stricter rule
    // than the server's.
    expect(periodOutsideSchedule({ from: '2026-08-01', until: '2026-09-15' }, schedule)).toBe(false);
  });

  it('never marks an untouched row — no dates is open-ended, which always overlaps', () => {
    expect(periodOutsideSchedule({ from: '', until: '' }, schedule)).toBe(false);
  });

  it('respects the series end when the schedule has one', () => {
    const bounded = { from: '2026-08-30', until: '2026-09-30' };
    expect(periodOutsideSchedule({ from: '2026-10-01', until: '' }, bounded)).toBe(true);
    expect(periodOutsideSchedule({ from: '2026-09-30', until: '' }, bounded)).toBe(false);
  });

  it('treats an open schedule as unbounded rather than as empty', () => {
    // The sentinels must behave as ±∞: `''` collapsing to the empty string
    // would compare BELOW every real date and refuse everything.
    expect(periodOutsideSchedule({ from: '2020-01-01', until: '2020-01-02' }, { from: '', until: '' })).toBe(false);
    expect(rangesOverlap({ from: '', until: '' }, { from: '', until: '' })).toBe(true);
  });
});

describe('periodEndsBeforeItStarts', () => {
  it('is a SEPARATE mistake from being outside the schedule', () => {
    // Reversed ends and a period in the wrong place need different fixes, so
    // they must not share one sentence.
    expect(periodEndsBeforeItStarts({ from: '2026-09-10', until: '2026-09-01' })).toBe(true);
    expect(periodEndsBeforeItStarts({ from: '2026-09-01', until: '2026-09-10' })).toBe(false);
  });

  it('is not triggered by an open end', () => {
    expect(periodEndsBeforeItStarts({ from: '2026-09-01', until: '' })).toBe(false);
    expect(periodEndsBeforeItStarts({ from: '', until: '2026-09-01' })).toBe(false);
  });
});

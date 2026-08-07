import { describe, expect, it } from 'vitest';

import { patternOf, specOf, type RecurrenceValue } from './recurrence-editor.js';
import { weekdaysForClass } from '../../adapters/scheduling.js';

/**
 * **The recurrence vocabulary is one mapping, and this is where it is proved.**
 *
 * Eight patterns a person picks, seven `RecurrenceType` values the database
 * stores — the two biweekly patterns share an enum value and are told apart by
 * whether a weekday set was given. That asymmetry is the whole reason a
 * round-trip test exists: a mapping that loses which pattern was meant would
 * reopen an edit form on the wrong option, silently.
 */
const value = (type: string, weekdays: string[] = []): RecurrenceValue => ({
  type,
  weekdays,
  startDate: '2026-09-01',
  endDate: '',
});

describe('every pattern survives a round trip', () => {
  it.each([
    ['once', 'none', []],
    ['daily', 'daily', []],
    ['weekly', 'weekly', []],
    ['weekly_days', 'multiple_weekdays', ['tuesday']],
    ['biweekly', 'biweekly_alternating', []],
    ['biweekly_days', 'biweekly_alternating', ['tuesday', 'friday']],
    ['monthly', 'monthly', []],
    ['yearly', 'yearly', []],
  ] as const)('%s ⇄ %s', (pattern, type, weekdays) => {
    // Forward: the pattern names the enum value it stores.
    expect(specOf(pattern).type).toBe(type);
    // Back: the stored pair resolves to the pattern that was chosen.
    expect(patternOf(value(type, [...weekdays]))).toBe(pattern);
  });

  it('tells the two biweekly patterns apart by the weekday set alone', () => {
    // One enum value, two questions. If this collapsed, an administrator who
    // chose "every two weeks on Tuesday and Friday" would reopen the form
    // showing "every two weeks" and lose their days on the next save.
    expect(patternOf(value('biweekly_alternating', []))).toBe('biweekly');
    expect(patternOf(value('biweekly_alternating', ['tuesday']))).toBe('biweekly_days');
  });
});

describe('"weekly" means the same thing for a class as for an activity', () => {
  // The divergence this unification closes: `expandEvent` reads plain `weekly`
  // as every seven days from the start date, `expandSchedule` reads it as the
  // weekdays listed. They agree exactly when the set is the start date's own
  // weekday — so the adapter fills it, and one editor can serve both.
  it('derives the start date’s weekday when none was chosen', () => {
    // 2026-09-01 is a Tuesday.
    expect(weekdaysForClass('weekly', [], '2026-09-01')).toEqual(['tuesday']);
    // 2026-09-06 is a Sunday — the Monday-first index (BR-17) must not be
    // off by one at the week boundary, which is where a naive mapping breaks.
    expect(weekdaysForClass('weekly', [], '2026-09-06')).toEqual(['sunday']);
    expect(weekdaysForClass('weekly', [], '2026-09-07')).toEqual(['monday']);
  });

  it('never overrides days the person actually chose', () => {
    expect(weekdaysForClass('multiple_weekdays', ['friday'], '2026-09-01')).toEqual(['friday']);
  });

  it('leaves patterns that are not weekday-based alone', () => {
    // A monthly class is not "on Tuesdays"; inventing a weekday set for it
    // would narrow a rule the person did not narrow.
    for (const pattern of ['daily', 'monthly', 'yearly']) {
      expect(weekdaysForClass(pattern, [], '2026-09-01')).toEqual([]);
    }
  });
});

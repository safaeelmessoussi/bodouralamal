import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { patternOf, RecurrenceEditor, specOf, type RecurrenceValue } from './recurrence-editor.js';
import { weekdaysForClass } from '../../adapters/scheduling.js';
import { ar } from '../../i18n/ar.js';

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

  it('R137 — a one-time class (`none`) never gets a weekday filled in', () => {
    // A single occurrence is named by `anchor_date` alone; a filled-in
    // weekday would misrepresent it as a recurring pattern.
    expect(weekdaysForClass('none', [], '2026-09-01')).toEqual([]);
  });
});

/**
 * **R137 item 9 — a one-time item's own span end date now shares the
 * `.form__row` beside start date, instead of standing full-width below the
 * whole editor.**
 *
 * The slot is the same one *repeat until* occupies for a repeating pattern —
 * `مرة واحدة` has no *repeat until*, so a caller whose kind can span several
 * calendar days (a holiday) fills that same slot with its own end date
 * instead. The two are mutually exclusive by construction: a one-time item is
 * never also repeating.
 */
describe('the span end date shares the start-date row (R137)', () => {
  const once = (): RecurrenceValue => ({
    type: 'none',
    weekdays: [],
    startDate: '2026-09-01',
    endDate: '',
  });

  it('renders no end-of-anything field when the caller offers no span end', () => {
    const html = renderToStaticMarkup(
      createElement(RecurrenceEditor, { value: once(), onChange: () => {} }),
    );
    expect(html).toContain(ar.scheduling.startDate);
    expect(html).not.toContain(ar.scheduling.endDate);
    expect(html).not.toContain(ar.scheduling.recurrenceEnd);
  });

  it('renders the span end date beside start date when the caller offers one, for مرة واحدة', () => {
    const html = renderToStaticMarkup(
      createElement(RecurrenceEditor, {
        value: once(),
        onChange: () => {},
        spanEnd: { value: '', onChange: () => {} },
      }),
    );
    expect(html).toContain(ar.scheduling.startDate);
    expect(html).toContain(ar.scheduling.endDate);
    // There is exactly ONE `.form__row` on this editor — if the span end date
    // were rendered as its own standalone field below (the old defect), a
    // second row would exist to hold it.
    expect(html.match(/form__row/g)?.length).toBe(1);
    expect(html.indexOf(ar.scheduling.startDate)).toBeLessThan(html.indexOf(ar.scheduling.endDate));
  });

  it('never shows both the span end date and *repeat until* at once — a one-time item is never also repeating', () => {
    const html = renderToStaticMarkup(
      createElement(RecurrenceEditor, {
        value: once(),
        onChange: () => {},
        spanEnd: { value: '', onChange: () => {} },
      }),
    );
    expect(html).not.toContain(ar.scheduling.recurrenceEnd);
  });

  it('a repeating pattern still shows *repeat until*, ignoring a span end the caller happened to pass', () => {
    const weekly: RecurrenceValue = { type: 'weekly', weekdays: [], startDate: '2026-09-01', endDate: '' };
    const html = renderToStaticMarkup(
      createElement(RecurrenceEditor, {
        value: weekly,
        onChange: () => {},
        spanEnd: { value: '2026-09-10', onChange: () => {} },
      }),
    );
    expect(html).toContain(ar.scheduling.recurrenceEnd);
    expect(html).not.toContain(ar.scheduling.endDate);
  });
});

import { describe, expect, it } from 'vitest';

import { ageOn, isSelfManagementEligible, parseBirthDate } from './birth-date.js';

const TODAY = new Date('2026-09-03T11:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('parseBirthDate', () => {
  it('accepts an ordinary date and returns UTC midnight (TD-11)', () => {
    const result = parseBirthDate('2010-04-17', TODAY);
    expect(result.ok).toBe(true);
    expect(result.ok && result.date.toISOString()).toBe('2010-04-17T00:00:00.000Z');
  });

  it('accepts a leap day', () => {
    expect(parseBirthDate('2008-02-29', TODAY).ok).toBe(true);
  });

  it('REFUSES a date that does not exist — JavaScript would roll it forward', () => {
    // `new Date('2026-02-31')` is the 3rd of March, silently. That is the whole
    // reason this does not reuse the shared `calendarDate` validator.
    const result = parseBirthDate('2010-02-31', TODAY);
    expect(result).toEqual({ ok: false, problem: 'NOT_A_REAL_DATE' });
    expect(parseBirthDate('2011-02-29', TODAY)).toEqual({
      ok: false,
      problem: 'NOT_A_REAL_DATE',
    });
    expect(parseBirthDate('2010-13-01', TODAY)).toEqual({
      ok: false,
      problem: 'NOT_A_REAL_DATE',
    });
  });

  it('REFUSES anything that is not YYYY-MM-DD', () => {
    for (const bad of ['17/04/2010', '2010-4-7', '2010-04-17T00:00:00Z', '', 'أمس']) {
      expect(parseBirthDate(bad, TODAY).ok, bad).toBe(false);
    }
  });

  it('REFUSES the future, and accepts today', () => {
    expect(parseBirthDate('2026-09-04', TODAY)).toEqual({
      ok: false,
      problem: 'IN_THE_FUTURE',
    });
    // Born today is not in the future — and the time of day must not decide it.
    expect(parseBirthDate('2026-09-03', TODAY).ok).toBe(true);
  });

  it('REFUSES an implausible year as a typo, not as an eligibility rule', () => {
    expect(parseBirthDate('1092-05-03', TODAY)).toEqual({
      ok: false,
      problem: 'IMPLAUSIBLY_OLD',
    });
    // 120 years to the day is still accepted: the bound is a slipped digit, and
    // nothing here refuses a person for being old.
    expect(parseBirthDate('1906-09-03', TODAY).ok).toBe(true);
  });
});

describe('ageOn — completed years', () => {
  it('does not count a birthday that has not happened yet this year', () => {
    // The arithmetic a naive year subtraction gets wrong for about half the
    // population on any given day.
    expect(ageOn(day('2008-12-25'), TODAY)).toBe(17);
    expect(ageOn(day('2008-09-03'), TODAY)).toBe(18);
    expect(ageOn(day('2008-09-04'), TODAY)).toBe(17);
  });

  it('reads the age AT a date, not the age now', () => {
    // R122's rule applied to people: the relevant fact is the one covering the
    // date in question.
    const born = day('2010-01-01');
    expect(ageOn(born, day('2020-06-01'))).toBe(10);
    expect(ageOn(born, day('2028-06-01'))).toBe(18);
  });
});

describe('isSelfManagementEligible', () => {
  it('is eligible ON the eighteenth birthday and not the day before', () => {
    expect(isSelfManagementEligible(day('2008-09-03'), TODAY)).toBe(true);
    expect(isSelfManagementEligible(day('2008-09-04'), TODAY)).toBe(false);
  });

  it('says ELIGIBLE and nothing more — it performs no transition', () => {
    // Deliberately a pure predicate. There is no birthday job, no automatic
    // family-link revocation and no automatic identity binding: an account that
    // changes hands while nobody is looking is one nobody decided to hand over.
    expect(typeof isSelfManagementEligible(day('2000-01-01'), TODAY)).toBe('boolean');
  });
});

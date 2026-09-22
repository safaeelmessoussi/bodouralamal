import { describe, expect, it } from 'vitest';

import { ageRangeLabel, categoriesForChild, categoriesForSelf, categoryOptionLabel } from './category-audience.js';

/**
 * **A Category says who holds the login** (SRS Revision 170 §6, closing the gap
 * R64.7 recorded): a woman registering HERSELF is never offered a Category a
 * guardian registers into, and a child application is never offered one whose
 * beneficiaries hold their own account. «Not stated» restricts nothing.
 */
const WOMEN = { id: 'c1', name: 'المرأة', holds_own_login: true, min_age: 18, max_age: null };
const GIRLS = { id: 'c2', name: 'اليافعات', holds_own_login: false, min_age: 13, max_age: 17 };
const CHILD = { id: 'c3', name: 'الطفل', holds_own_login: false, min_age: null, max_age: 12 };
const LEGACY = { id: 'c4', name: 'فئة قديمة', holds_own_login: null, min_age: null, max_age: null };
const BARE = { id: 'c5', name: 'بلا علامة' };
const ALL = [WOMEN, GIRLS, CHILD, LEGACY, BARE];

describe('which Categories a form offers', () => {
  it('self-registration: never one a guardian registers into', () => {
    expect(categoriesForSelf(ALL).map((c) => c.id)).toEqual(['c1', 'c4', 'c5']);
  });

  it('a child application: never one whose beneficiaries hold their own login', () => {
    expect(categoriesForChild(ALL).map((c) => c.id)).toEqual(['c2', 'c3', 'c4', 'c5']);
  });

  it('«not stated» — null or absent — is offered to BOTH, exactly as before the marker existed', () => {
    for (const category of [LEGACY, BARE]) {
      expect(categoriesForSelf([category])).toHaveLength(1);
      expect(categoriesForChild([category])).toHaveLength(1);
    }
  });
});

describe('the age range is said, and gates nothing', () => {
  it('names both ends, one end, or nothing', () => {
    expect(ageRangeLabel(GIRLS)).toBe('من 13 إلى 17 سنة');
    expect(ageRangeLabel(WOMEN)).toBe('من 18 سنة');
    expect(ageRangeLabel(CHILD)).toBe('حتى 12 سنة');
    expect(ageRangeLabel(LEGACY)).toBeNull();
  });

  it('an option is the name, with the range beside it only where one is stated', () => {
    expect(categoryOptionLabel(GIRLS)).toBe('اليافعات (من 13 إلى 17 سنة)');
    expect(categoryOptionLabel(LEGACY)).toBe('فئة قديمة');
  });

  it('zero is an age, not «not stated»', () => {
    expect(ageRangeLabel({ min_age: 0, max_age: 5 })).toBe('من 0 إلى 5 سنة');
  });
});

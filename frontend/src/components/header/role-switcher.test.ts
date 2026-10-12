import { describe, expect, it } from 'vitest';

import { labelOfRole } from './role-switcher.js';

describe('R221 — the beneficiary role in its holder’s gender', () => {
  it('says «مستفيدة» for her, «مستفيد» for him, «مستفيد(ة)» while unknown, and leaves other roles alone', () => {
    expect(labelOfRole('student', 'female')).toBe('مستفيدة');
    expect(labelOfRole('student', 'male')).toBe('مستفيد');
    expect(labelOfRole('student', null)).toBe('مستفيد(ة)');
    expect(labelOfRole('teacher', 'male')).toBe('مؤطِّرة');
  });
});

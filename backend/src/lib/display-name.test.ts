import { describe, expect, it } from 'vitest';

import { publicDisplayName } from './display-name.js';

/**
 * The public display name (SRS Revision 36.1).
 *
 * These matter more than their size suggests: choosing the wrong branch
 * publishes a person's **legal name** where she asked for a kunya. The rule has
 * exactly one implementation for that reason, and this pins its edges.
 */
const person = (over: Partial<{ publicDisplayName: string | null; nameArabic: string }> = {}) => ({
  publicDisplayName: null,
  nameArabic: 'فاطمة الزهراء بنعلي',
  ...over,
});

describe('choosing the public name', () => {
  it('uses the chosen public name when set', () => {
    expect(publicDisplayName(person({ publicDisplayName: 'أم عبد الله' }))).toBe('أم عبد الله');
  });

  it('falls back to the full name when unset', () => {
    expect(publicDisplayName(person())).toBe('فاطمة الزهراء بنعلي');
  });

  it('treats an empty or whitespace-only value as unset', () => {
    // The failure this prevents: a blank reads as "set" and renders as nothing,
    // publishing an unnamed instructor instead of falling back.
    for (const blank of ['', '   ', '\t', '\n ']) {
      expect(publicDisplayName(person({ publicDisplayName: blank }))).toBe('فاطمة الزهراء بنعلي');
    }
  });

  it('trims a chosen name rather than publishing the padding', () => {
    expect(publicDisplayName(person({ publicDisplayName: '  أم عبد الله  ' }))).toBe('أم عبد الله');
  });

  it('never returns the legal name when a public one was chosen', () => {
    // Stated as its own assertion because it is the actual privacy promise.
    const result = publicDisplayName(person({ publicDisplayName: 'أم عبد الله' }));
    expect(result).not.toContain('فاطمة');
    expect(result).not.toContain('بنعلي');
  });
});

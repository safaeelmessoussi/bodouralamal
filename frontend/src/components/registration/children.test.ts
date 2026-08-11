import { describe, expect, it } from 'vitest';

import { EMPTY_CHILD, toChildInput, validateChildren, type ChildForm } from './children.js';
import { validate as validateProfileForm } from '../../pages/profile/register-child.js';

/**
 * The child section is **one implementation used by two flows** (R65).
 *
 * These assertions are deliberately written against the shared module and then
 * again through the personal page, because the defect this replaced was not a
 * wrong rule — it was the *same* rule implemented twice, where only one copy
 * kept the repeatable behaviour.
 */
const child = (over: Partial<ChildForm> = {}): ChildForm => ({
  ...EMPTY_CHILD,
  firstNameArabic: 'مريم',
  lastNameArabic: 'بنعلي',
  sex: 'female',
  mediaRelease: 'no',
  ...over,
});

describe('validateChildren — one rule set, keyed per sibling', () => {
  it('accepts a complete child', () => {
    expect(validateChildren([child()])).toEqual({});
  });

  it('marks the RIGHT sibling, not merely "a child"', () => {
    const errors = validateChildren([child(), child({ firstNameArabic: '' })]);
    expect(errors).not.toHaveProperty('children.0.firstNameArabic');
    expect(errors).toHaveProperty('children.1.firstNameArabic');
  });

  it('requires a media-release DECISION per child, and accepts "no" (BR-1)', () => {
    const errors = validateChildren([child({ mediaRelease: '' })]);
    expect(errors).toHaveProperty('children.0.mediaRelease');
    expect(validateChildren([child({ mediaRelease: 'no' })])).toEqual({});
  });

  it('R41: the French pair is optional but indivisible', () => {
    expect(validateChildren([child({ firstNameFrench: 'Meriem' })])).toHaveProperty(
      'children.0.lastNameFrench',
    );
  });
});

describe('the personal page applies the SAME child rules (R65)', () => {
  it('accepts several children at once — the behaviour it had lost', () => {
    // It submitted one child at a time while `/register` took a family in one
    // request; a parent of three made three requests from this page.
    expect(validateProfileForm([child(), child()], 'b1', 'c1', true)).toEqual({});
  });

  it('rejects the same way, on the same keys', () => {
    const errors = validateProfileForm([child(), child({ sex: '' })], 'b1', 'c1', true);
    expect(errors).toHaveProperty('children.1.sex');
  });

  it('adds only the request-level answers this surface collects', () => {
    // R64 — the branch and the stage. `/register` asks them once for the
    // family; here they are asked per submission.
    const errors = validateProfileForm([child()], null, null, false);
    expect(Object.keys(errors).sort()).toEqual(['branch', 'category', 'dataProcessing']);
  });
});

describe('toChildInput — one translation to the wire', () => {
  it('omits an unanswered optional rather than sending an empty string', () => {
    const input = toChildInput(child());
    expect(input).not.toHaveProperty('nickname');
    expect(input).not.toHaveProperty('schooling_stage');
    expect(input).not.toHaveProperty('first_name_french');
    // R62.1 — never collected about a minor, so never sent.
    expect(input).not.toHaveProperty('phone');
    expect(input).not.toHaveProperty('notes');
  });

  it('always sends the media release, because absence is not refusal (BR-1)', () => {
    expect(toChildInput(child({ mediaRelease: 'no' })).consent_media_release).toBe(false);
    expect(toChildInput(child({ mediaRelease: 'yes' })).consent_media_release).toBe(true);
  });
});

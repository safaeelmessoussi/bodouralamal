import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  EMPTY_CHILD,
  NameFields,
  toChildInput,
  validateChildren,
  type ChildForm,
} from './children.js';
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
  // R67 — required per child; a fixture omitting them is testing the refusal.
  branchId: 'b1',
  categoryId: 'c1',
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

  it('states the optional-pair rule beside both French fields', () => {
    const markup = renderToStaticMarkup(
      createElement(NameFields, {
        value: child(),
        onChange: () => undefined,
        errors: {},
        prefix: 'children.0',
      }),
    );
    expect(
      markup.match(/اختياريان معاً: أدخلي الاسمين بالفرنسية أو اتركي الحقلين فارغين\./g),
    ).toHaveLength(2);
  });
});

describe('the personal page applies the SAME child rules (R65)', () => {
  it('accepts several children at once — the behaviour it had lost', () => {
    // It submitted one child at a time while `/register` took a family in one
    // request; a parent of three made three requests from this page.
    expect(validateProfileForm([child(), child()], true)).toEqual({});
  });

  it('rejects the same way, on the same keys', () => {
    const errors = validateProfileForm([child(), child({ sex: '' })], true);
    expect(errors).toHaveProperty('children.1.sex');
  });

  it('R67: each child needs its OWN branch and stage', () => {
    // They were one answer for the whole family, copied onto every application,
    // so a parent could not ask for two children at two branches.
    const errors = validateChildren([child({ branchId: '' }), child({ categoryId: '' })]);
    expect(errors).toHaveProperty('children.0.branchId');
    expect(errors).toHaveProperty('children.1.categoryId');
    expect(errors).not.toHaveProperty('children.0.categoryId');
  });

  it('R67: two children may differ in both', () => {
    expect(
      validateChildren([
        child({ branchId: 'b1', categoryId: 'c1' }),
        child({ branchId: 'b2', categoryId: 'c2' }),
      ]),
    ).toEqual({});
  });

  it('adds only the request-level answers this surface collects', () => {
    // R64 — the branch and the stage. `/register` asks them once for the
    // family; here they are asked per submission.
    // R67 — only the consent is request-level now; the branch and stage moved
    // onto each child.
    const errors = validateProfileForm([child()], false);
    expect(Object.keys(errors).sort()).toEqual(['dataProcessing']);
  });
});

describe('toChildInput — one translation to the wire', () => {
  it('omits an unanswered optional rather than sending an empty string', () => {
    const input = toChildInput(child());
    // R67 — always sent, because validation refuses the form without them.
    expect(input.requested_branch_id).toBe('b1');
    expect(input.requested_category_id).toBe('c1');
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

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { FramingPreferenceValue } from '../../components/teaching/framing-preference-summary.js';
import {
  initialPlacementChoices,
  registrationNeedsApplicantPlacement,
} from './approvals.js';

describe('R117 registration decision surface', () => {
  it('places an adult applicant but never a children-only guardian', () => {
    expect(registrationNeedsApplicantPlacement({ type: 'registration', children: [] })).toBe(true);
    expect(
      registrationNeedsApplicantPlacement({
        type: 'registration',
        children: [{}] as never,
      }),
    ).toBe(false);
  });

  it('does not mistake another approval type for a beneficiary registration', () => {
    expect(registrationNeedsApplicantPlacement({ type: 'family-link', children: [] })).toBe(false);
  });

  it("defaults every sibling from that child's own Category and Branch", () => {
    const choices = initialPlacementChoices(
      [
        {
          id: 'child-a',
          name: 'الأولى',
          requestedCategory: { id: 'category-a', name: 'الفئة أ' },
          requestedBranch: { id: 'branch-a', name: 'المقر أ' },
        },
        {
          id: 'child-b',
          name: 'الثانية',
          requestedCategory: { id: 'category-b', name: 'الفئة ب' },
          requestedBranch: { id: 'branch-b', name: 'المقر ب' },
        },
      ],
      [
        { id: 'level-a', category_id: 'category-a' },
        { id: 'level-b', category_id: 'category-b' },
      ],
      [{ id: 'group-a', level_id: 'level-a' }],
    );

    expect(choices).toEqual({
      'child-a': { levelId: 'level-a', groupId: 'group-a', branchId: '' },
      'child-b': { levelId: 'level-b', groupId: '', branchId: 'branch-b' },
    });
  });

  it('does not invent a default for a legacy child with no requested Category', () => {
    expect(
      initialPlacementChoices(
        [{ id: 'legacy', name: 'قديمة', requestedCategory: null, requestedBranch: null }],
        [{ id: 'level-a', category_id: 'category-a' }],
        [],
      ),
    ).toEqual({});
  });
});

describe('staff approval framing summary', () => {
  it('shows online without inventing a physical branch', () => {
    const html = renderToStaticMarkup(
      <FramingPreferenceValue framing={{ mode: 'online', all_branches: false, branches: [] }} />,
    );
    expect(html).toContain(ar.register.framingMode_online);
    expect(html).not.toContain(ar.framing.allBranches);
  });

  it('shows every explicitly selected branch', () => {
    const html = renderToStaticMarkup(
      <FramingPreferenceValue
        framing={{
          mode: 'both',
          all_branches: false,
          branches: [
            { id: 'b1', name: 'مقر أمرشيش' },
            { id: 'b2', name: 'مقر تاركة' },
          ],
        }}
      />,
    );
    expect(html).toContain(ar.register.framingMode_both);
    expect(html).toContain('مقر أمرشيش، مقر تاركة');
  });

  it('renders the future-inclusive all-branches meaning explicitly', () => {
    const html = renderToStaticMarkup(
      <FramingPreferenceValue
        framing={{ mode: 'in_person', all_branches: true, branches: [] }}
      />,
    );
    expect(html).toContain(ar.framing.allBranches);
  });

  it('keeps legacy requests honest as not stated', () => {
    expect(renderToStaticMarkup(<FramingPreferenceValue framing={null} />)).toContain(
      ar.framing.notStated,
    );
  });
});

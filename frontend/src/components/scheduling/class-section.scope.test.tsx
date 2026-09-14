import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActivitySection, type ScopeDimensionValue } from './class-section.js';
import { t } from '../../i18n/index.js';
import SCHEDULING_SOURCE from '../../pages/admin/scheduling.tsx?raw';

/**
 * **R139 — the activity/holiday scope picker takes SEVERAL dimensions at
 * once, each independent** (redesigned 2026-09-14, Owner-reported).
 *
 * `EventScopes` (`event.service.ts`) has always accepted an array per
 * dimension — `branchIds`/`categoryIds`/`levelIds`/`groupIds` — and the
 * audience-matching read has always UNIONed them (`OR`, `calendar.
 * service.ts`): an event reaches someone whose branch, OR category, OR
 * Level, OR group matches ANY chosen dimension. The picker used to force a
 * single "kind" choice first (a `<select>` defaulted to a value not always
 * present in its own options — the defect the Owner actually reported,
 * showing as a blank sub-picker until reselected) and only THEN offered one
 * shared multi-select for whichever kind was picked. Now every dimension
 * the caller may fill renders its own independent, always-visible
 * `MultiSelectField` — "these branches AND that category" is a single
 * request, not a choice between the two.
 *
 * `MultiSelectField` stays collapsed until opened (its own established
 * behaviour), so what is assertable here through a static render is the
 * TRIGGER's own summary — which `chosenCount` derives directly from
 * `selected` — rather than the option list underneath it.
 */
const dim = (selected: string[] = []): ScopeDimensionValue => ({
  selected,
  onChange: () => {},
  options: [
    { id: 'b1', name: '[تجريبي] مقر أمرشيش' },
    { id: 'b2', name: '[تجريبي] مقر تاركة' },
  ],
});

const baseProps = {
  allowGlobal: false,
  global: false,
  onGlobal: () => {},
  locked: false,
  staff: [],
  responsibleId: '',
  onResponsible: () => {},
  assistantIds: [],
  onAssistants: () => {},
  canAssignStaff: true,
};

describe('each dimension is independent, always visible, and takes several at once', () => {
  it('reflects the chosen COUNT in the branch trigger, for more than one', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        dimensions={['branch', 'category']}
        values={{ branch: dim(['b1', 'b2']), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).toContain(t('common.selectedCount').replace('{n}', '2'));
  });

  it('renders BOTH dimensions at once — branch and category are not mutually exclusive', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        dimensions={['branch', 'category']}
        values={{ branch: dim(['b1']), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).toContain(t('admin.calendar.scopeBranch'));
    expect(html).toContain(t('admin.calendar.scopeCategory'));
  });

  it('renders only the caller\'s own allowed dimensions — never one it did not list', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        canAssignStaff={false}
        dimensions={['group']}
        values={{ branch: dim(), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).toContain(t('admin.calendar.scopeGroup'));
    expect(html).not.toContain(t('admin.calendar.scopeBranch'));
    expect(html).not.toContain(t('admin.calendar.scopeCategory'));
    expect(html).not.toContain(t('admin.calendar.scopeLevel'));
  });

  it('states the empty case in words, not a blank control', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        dimensions={['branch']}
        values={{ branch: dim(), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).toContain(t('admin.calendar.scopeTargetEmpty'));
  });
});

describe('"all Levels within the chosen branch(es)" is stated, not left implicit', () => {
  it('shows the hint once at least one branch is chosen', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        dimensions={['branch', 'level']}
        values={{ branch: dim(['b1']), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).toContain(t('admin.calendar.scopeAllLevelsHint'));
  });

  it('does not show it before any branch is chosen', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        dimensions={['branch', 'level']}
        values={{ branch: dim(), category: dim(), level: dim(['l1']), group: dim() }}
      />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeAllLevelsHint'));
  });

  it('does not render at all when branch is not among the caller\'s dimensions', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        dimensions={['level']}
        values={{ branch: dim(['b1']), category: dim(), level: dim(['l1']), group: dim() }}
      />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeAllLevelsHint'));
  });
});

describe('"association-wide" is a checkbox beside the dimensions, mutually exclusive with them', () => {
  it('is offered only when allowGlobal is set', () => {
    const withGlobal = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        allowGlobal
        dimensions={['branch']}
        values={{ branch: dim(), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(withGlobal).toContain(t('admin.calendar.scopeGlobal'));
    expect(withGlobal).toContain(t('admin.calendar.scopeGlobalHint'));

    const withoutGlobal = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        allowGlobal={false}
        dimensions={['branch']}
        values={{ branch: dim(), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(withoutGlobal).not.toContain(t('admin.calendar.scopeGlobalHint'));
  });

  it('renders no dimension picker at all once checked', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        allowGlobal
        global
        dimensions={['branch', 'category']}
        values={{ branch: dim(['b1']), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeTargetLabel'));
  });
});

/**
 * **The submitted payload carries every chosen dimension, combined, not one
 * dimension alone** (R139). `saveSchedulingItem`'s own data-loss test
 * (2026-08-20's comment, still in the source) already pinned "an unchosen
 * scope is not an empty id"; this pins the SAME site's redesigned other
 * half — every non-empty dimension reaches the payload together. Asserted
 * against the source: the payload only exists inside a `submit()` closure a
 * render test cannot reach without a live token, a session and a real
 * network round trip.
 */
describe('the submitted scope carries every dimension the reader chose, combined', () => {
  const source = SCHEDULING_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('builds one object from whichever dimensions are non-empty, never a single-dimension ternary', () => {
    expect(source).toContain('...(branchIds.length > 0 ? { branchIds } : {})');
    expect(source).toContain('...(categoryIds.length > 0 ? { categoryIds } : {})');
    expect(source).toContain('...(levelIds.length > 0 ? { levelIds } : {})');
    expect(source).toContain('...(groupIds.length > 0 ? { groupIds } : {})');
    // The R139 defect this replaces — pinned absent rather than merely
    // untested, so a regression back to it fails loudly.
    expect(source).not.toContain('[scopeId]');
  });

  it('an unchosen scope is still `undefined`, never an empty object sent as a real choice', () => {
    expect(source).toMatch(
      /branchIds\.length === 0 &&\s*\n\s*categoryIds\.length === 0 &&\s*\n\s*levelIds\.length === 0 &&\s*\n\s*groupIds\.length === 0\s*\n\s*\? undefined/,
    );
  });

  it('the scope-required check on activity/holiday creation is skipped on edit — the picker is locked and hidden there', () => {
    expect(source).toMatch(
      /!editing &&\s*\n\s*!global &&\s*\n\s*branchIds\.length === 0 &&\s*\n\s*categoryIds\.length === 0 &&\s*\n\s*levelIds\.length === 0 &&\s*\n\s*groupIds\.length === 0/,
    );
  });
});

describe('locked (editing) shows the fixed-at-creation notice and nothing choosable', () => {
  it('renders no picker and no hints once locked', () => {
    const html = renderToStaticMarkup(
      <ActivitySection
        {...baseProps}
        locked
        dimensions={['branch']}
        values={{ branch: dim(['b1']), category: dim(), level: dim(), group: dim() }}
      />,
    );
    expect(html).toContain(t('admin.calendar.scopeFixed'));
    expect(html).not.toContain(t('admin.calendar.scopeTargetLabel'));
    expect(html).not.toContain(t('admin.calendar.scopeAllLevelsHint'));
  });
});

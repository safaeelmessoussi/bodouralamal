import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActivitySection } from './class-section.js';
import { t } from '../../i18n/index.js';
import SCHEDULING_SOURCE from '../../pages/admin/scheduling.tsx?raw';

/**
 * **R139 — the activity/holiday scope picker takes SEVERAL, not one.**
 *
 * `EventScopes` (`event.service.ts`) has always accepted an array per
 * dimension — `branchIds`/`categoryIds`/`levelIds`/`groupIds` — and the
 * audience-matching reads have always honoured every row a dimension
 * carries (`some`/`none`, `calendar.service.ts`). Only this picker still
 * asked for one id, which is what made «اختاري المستوى» read as a rule this
 * form imposed rather than one the platform actually has: an admin could
 * never express "these two branches" or "these two Levels" at all, only one
 * of either.
 *
 * `MultiSelectField` stays collapsed until opened (its own established
 * behaviour), so what is assertable here through a static render is the
 * TRIGGER's own summary — which `chosenCount` derives directly from
 * `selected`/`scopeIds` — rather than the option list underneath it.
 */
const baseProps = {
  scopeKind: 'branch',
  onScopeKind: () => {},
  onScopeIds: () => {},
  scopeOptions: [
    { id: 'b1', name: '[تجريبي] مقر أمرشيش' },
    { id: 'b2', name: '[تجريبي] مقر تاركة' },
  ],
  locked: false,
  staff: [],
  responsibleId: '',
  onResponsible: () => {},
  assistantIds: [],
  onAssistants: () => {},
  canAssignStaff: true,
};

describe('the scope picker accepts several branches/Levels/categories at once', () => {
  it('reflects the chosen COUNT in the collapsed trigger, for more than one', () => {
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} scopeIds={['b1', 'b2']} />);
    expect(html).toContain(t('common.selectedCount').replace('{n}', '2'));
  });

  it('states the empty case in words, not a blank control', () => {
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} scopeIds={[]} />);
    expect(html).toContain(t('admin.calendar.scopeTargetEmpty'));
  });

  it('names the picker itself with the plural label (R139)', () => {
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} scopeIds={[]} />);
    expect(html).toContain(t('admin.calendar.scopeTargetLabel'));
  });
});

describe('"all Levels within the chosen branch(es)" is stated, not left implicit', () => {
  it('shows the hint once at least one branch is chosen, for scopeKind "branch"', () => {
    const html = renderToStaticMarkup(
      <ActivitySection {...baseProps} scopeKind="branch" scopeIds={['b1']} />,
    );
    expect(html).toContain(t('admin.calendar.scopeAllLevelsHint'));
  });

  it('does not show it before any branch is chosen', () => {
    const html = renderToStaticMarkup(
      <ActivitySection {...baseProps} scopeKind="branch" scopeIds={[]} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeAllLevelsHint'));
  });

  it('does not show it for a different dimension — it is not a reading "level" or "category" have', () => {
    const html = renderToStaticMarkup(
      <ActivitySection {...baseProps} scopeKind="level" scopeIds={['l1']} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeAllLevelsHint'));
  });
});

describe('"platform-wide" and "all my branches" read as one honest control (R139)', () => {
  it('states the global choice applies to whichever the actor actually has', () => {
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} scopeKind="global" scopeIds={[]} />);
    expect(html).toContain(t('admin.calendar.scopeGlobalHint'));
  });

  it('renders no target picker at all under the global choice', () => {
    // `scopeOptions` carries two branches here on purpose — proving the
    // absence is about `scopeKind`, not an empty options list.
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} scopeKind="global" scopeIds={[]} />);
    expect(html).not.toContain(t('admin.calendar.scopeTargetLabel'));
  });
});

/**
 * **The submitted payload carries every chosen id, not the first one alone**
 * (R139). `saveSchedulingItem`'s own data-loss test (2026-08-20's comment,
 * still in the source) already pinned "an unchosen scope is not an empty
 * id"; this pins the SAME site's other half — a chosen scope sends every id
 * the reader picked, on the SAME array `EventScopes` (`event.service.ts`)
 * has always accepted, never a single-element one that quietly dropped the
 * rest. Asserted against the source: the payload only exists inside a
 * `submit()` closure a render test cannot reach without a live token, a
 * session and a real network round trip.
 */
describe('the submitted scope carries the whole array the reader chose', () => {
  const source = SCHEDULING_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('sends `scopeIds` directly for every non-global dimension, never wrapped as a single element', () => {
    expect(source).toContain('{ branchIds: scopeIds }');
    expect(source).toContain('{ categoryIds: scopeIds }');
    expect(source).toContain('{ groupIds: scopeIds }');
    expect(source).toContain('{ levelIds: scopeIds }');
    // The R139 defect this replaces — pinned absent rather than merely
    // untested, so a regression back to it fails loudly.
    expect(source).not.toContain('[scopeId]');
  });

  it('an unchosen scope is still `undefined`, never an empty array sent as a real choice', () => {
    expect(source).toContain('scopeIds.length === 0');
  });

  it('switching the scope KIND clears the previous dimension\'s ids — a branch id must never be submitted as a Level id', () => {
    expect(source).toContain('setScopeKind(next);');
    expect(source).toContain('setScopeIds([]);');
  });

  it('the scope-required check on activity/holiday creation is skipped on edit — the picker is locked and hidden there', () => {
    expect(source).toContain("if (!editing && scopeKind !== 'global' && scopeIds.length === 0)");
  });
});

describe('locked (editing) shows the fixed-at-creation notice and nothing choosable', () => {
  it('renders no picker and no hints once locked', () => {
    const html = renderToStaticMarkup(
      <ActivitySection {...baseProps} locked scopeKind="branch" scopeIds={['b1']} />,
    );
    expect(html).toContain(t('admin.calendar.scopeFixed'));
    expect(html).not.toContain(t('admin.calendar.scopeTargetLabel'));
    expect(html).not.toContain(t('admin.calendar.scopeAllLevelsHint'));
  });
});

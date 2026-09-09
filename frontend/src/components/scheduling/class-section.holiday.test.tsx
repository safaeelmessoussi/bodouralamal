import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActivitySection } from './class-section.js';
import { ar } from '../../i18n/ar.js';
import SCHEDULING_SOURCE from '../../pages/admin/scheduling.tsx?raw';

/**
 * **R137 — عطلة has no responsible/assistant staff** (Owner, 2026-09-09).
 *
 * The server already refused staff on a holiday (`HOLIDAY_SHAPE`,
 * `event.service.ts`); this pins the frontend half — the control is gone from
 * the tree, not merely disabled, so there is nothing stale for a switch back
 * and forth to leave behind.
 */
const baseProps = {
  scopeKind: 'branch',
  onScopeKind: () => {},
  scopeId: '',
  onScopeId: () => {},
  scopeOptions: [],
  locked: false,
  staff: [],
  responsibleId: '',
  onResponsible: () => {},
  assistantIds: [],
  onAssistants: () => {},
  canAssignStaff: true,
};

describe('ActivitySection hides staffing entirely for عطلة', () => {
  it('renders no responsible/assistant picker when hideStaffing is set', () => {
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} hideStaffing />);
    expect(html).not.toContain(ar.admin.calendar.responsible);
    expect(html).not.toContain(ar.admin.calendar.eventAssistants);
  });

  it('renders the picker normally for a kind that IS staffed (default false)', () => {
    const html = renderToStaticMarkup(<ActivitySection {...baseProps} />);
    expect(html).toContain(ar.admin.calendar.responsible);
    expect(html).toContain(ar.admin.calendar.eventAssistants);
  });
});

describe('the save payload sends no staff at all for عطلة', () => {
  it('eventStaff is the empty array for holiday — never merely omitted', () => {
    expect(SCHEDULING_SOURCE).toContain("type === 'holiday'\n              ? []");
  });

  it('the ActivitySection call site hides staffing for holiday', () => {
    expect(SCHEDULING_SOURCE).toContain("hideStaffing={type === 'holiday'}");
  });

  it('switching TO holiday clears any staffing already typed for another kind', () => {
    expect(SCHEDULING_SOURCE).toContain("if (item !== null || type !== 'holiday') return;");
  });
});

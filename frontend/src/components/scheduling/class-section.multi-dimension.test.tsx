import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClassSection, type ClassDimensionValue } from './class-section.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import SCHEDULING_SOURCE from '../../pages/admin/scheduling.tsx?raw';

/**
 * **SRS Revision 155 — completed end to end, 2026-09-16.** The backend has
 * accepted `multi_dimension` since that revision; this is the admin
 * scheduling form's own picker, explicitly deferred at the time (§5: "the
 * capability is real and reachable by any caller of the API today... what
 * is NOT built: the admin scheduling form's own multi-select picker").
 *
 * `ClassSection` needs no session/context to render — it takes plain
 * props — so the picker itself is a live render, unlike the submitted
 * payload and validation rule below, which live inside `scheduling.tsx`'s
 * `submit()`/`validationError()` closures a render test cannot reach
 * without a live token, a session and a real network round trip (the same
 * technique `class-section.scope.test.tsx` and `class-section.staff-locked
 * .test.tsx` already established).
 */
const EMPTY_SCOPE: ScopeOptions = {
  value: {
    categoryId: '',
    levelId: '',
    subjectId: '',
    branchId: '',
    academicYearId: '',
    groupId: '',
  },
  set: () => {},
  setMany: () => {},
  options: {
    categoryId: [],
    levelId: [],
    subjectId: [],
    branchId: [],
    academicYearId: [],
    groupId: [],
  },
  loading: {
    categoryId: false,
    levelId: false,
    subjectId: false,
    branchId: false,
    academicYearId: false,
    groupId: false,
  },
  ready: true,
  levelTeachesNothing: false,
  defaultVisibility: null,
  selfAttendanceAllowed: null,
};

const dim = (selected: string[] = []): ClassDimensionValue => ({
  selected,
  onChange: () => {},
  options: [
    { id: 'l1', name: '[تجريبي] مستوى 1' },
    { id: 'l2', name: '[تجريبي] مستوى 2' },
  ],
});

const emptyMultiDimension = {
  branch: dim(),
  category: dim(),
  level: dim(),
  administrativeGroup: dim(),
  teachingGroup: dim(),
};

const baseProps = {
  scope: EMPTY_SCOPE,
  locked: false,
  mode: 'multi_dimension',
  onMode: () => {},
  modes: ['entire_level', 'administrative_group', 'multi_dimension'],
  rooms: [],
  roomId: '',
  onRoom: () => {},
  delivery: 'in_person' as const,
  onDelivery: () => {},
  mediaMode: 'audio_video' as const,
  onMediaMode: () => {},
  teachers: [],
  staffing: [],
  onStaffing: () => {},
  scheduleFrom: '',
  scheduleUntil: '',
};

describe('multi_dimension renders five independent pickers, never the legacy branch/level pair', () => {
  it('renders all five dimensions at once — they are not mutually exclusive', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} multiDimension={emptyMultiDimension} />,
    );
    expect(html).toContain(t('admin.calendar.scopeBranch'));
    expect(html).toContain(t('admin.calendar.scopeCategory'));
    expect(html).toContain(t('admin.calendar.scopeLevel'));
    expect(html).toContain(t('admin.calendar.scopeGroup'));
    expect(html).toContain(t('admin.calendar.scopeCircle'));
    expect(html).toContain(t('admin.calendar.multiDimensionHint'));
  });

  it('every other mode still renders the ordinary branch/Level pair, unaffected', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} mode="entire_level" multiDimension={emptyMultiDimension} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeCircle'));
    expect(html).not.toContain(t('admin.calendar.multiDimensionHint'));
  });

  it('reflects the chosen COUNT in the circle trigger — the one dimension Event never had', () => {
    const html = renderToStaticMarkup(
      <ClassSection
        {...baseProps}
        multiDimension={{ ...emptyMultiDimension, teachingGroup: dim(['l1', 'l2']) }}
      />,
    );
    expect(html).toContain(t('common.selectedCount').replace('{n}', '2'));
  });
});

describe('locked (editing) states the fixed-at-creation notice, never five empty-looking pickers', () => {
  it('renders the same scopeFixed sentence Event\'s own locked scope uses, and no picker', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} locked multiDimension={emptyMultiDimension} />,
    );
    expect(html).toContain(t('admin.calendar.scopeFixed'));
    expect(html).not.toContain(t('admin.calendar.scopeCircle'));
    expect(html).not.toContain(t('admin.calendar.multiDimensionHint'));
  });

  it('every other mode keeps its own existing locked behaviour (the ordinary pair, disabled)', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} mode="entire_level" locked multiDimension={emptyMultiDimension} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeFixed'));
  });
});

/**
 * **The submitted payload and the validation rule, pinned against the
 * source.** Mirrors `class-section.scope.test.tsx`'s own "the submitted
 * scope carries every dimension the reader chose, combined" describe
 * block for Events — the same shape, for a class's fifth dimension.
 */
describe('scheduling.tsx wires multi_dimension end to end', () => {
  const source = SCHEDULING_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('sends dimensions, never target_id, for multi_dimension — the reverse for every other mode', () => {
    expect(source).toContain("...(mode === 'multi_dimension'");
    expect(source).toContain(': { targetId }),');
  });

  it('builds dimensions from whichever of the five arrays are non-empty', () => {
    expect(source).toContain('...(branchIds.length > 0 ? { branchIds } : {})');
    expect(source).toContain('...(categoryIds.length > 0 ? { categoryIds } : {})');
    expect(source).toContain('...(levelIds.length > 0 ? { levelIds } : {})');
    expect(source).toContain('...(groupIds.length > 0 ? { administrativeGroupIds: groupIds } : {})');
    expect(source).toContain('...(teachingGroupIds.length > 0 ? { teachingGroupIds } : {})');
  });

  it('requires at least a Level, group or circle on create — never on edit', () => {
    expect(source).toMatch(
      /!editing &&\s*\n\s*levelIds\.length === 0 &&\s*\n\s*groupIds\.length === 0 &&\s*\n\s*teachingGroupIds\.length === 0/,
    );
  });

  it('reads administrative groups and circles UNSCOPED, never through the chained scope.options.groupId', () => {
    // §4.4c's own chain needs a Level AND a branch before it answers
    // anything; a class naming several at once needs every group/circle
    // reachable, which is why this is a SEPARATE read.
    expect(source).toContain("mode !== 'multi_dimension') return;");
    expect(source).toContain('listAdministrativeGroups(token, 1, {}, null, 100)');
    expect(source).toContain('listCircles(token, 1, {}, null, 100)');
  });

  it('offers the mode only where the other two are already offered — never to a self-service Teacher', () => {
    expect(source).toContain(
      "const MODES = ['administrative_group', 'entire_level', 'multi_dimension'] as const;",
    );
    expect(source).toContain("modes={canAssignStaff ? MODES : (['entire_level'] as const)}");
  });
});

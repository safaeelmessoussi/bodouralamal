import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClassSection } from './class-section.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import SCHEDULING_SOURCE from '../../pages/admin/scheduling.tsx?raw';
import SESSIONS_RAW from '../../pages/admin/schedule-sessions.tsx?raw';
import FILTERS_RAW from './audience-filters.tsx?raw';
import { audienceDimensions, homeBranchOf, namesATeachingPopulation } from './audience-filters.js';

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
  levelCategoryIds: {},
  subjectsBySurah: new Set<string>(),
  levelSurahIds: {},
  surahNames: {},
  defaultVisibility: null,
  selfAttendanceAllowed: null,
};

const NOOP = (): void => {};
const SETTERS = {
  setBranchIds: NOOP,
  setCategoryIds: NOOP,
  setLevelIds: NOOP,
  setGroupIds: NOOP,
  setTeachingGroupIds: NOOP,
};
const CHOICES = [
  { id: 'l1', name: '[تجريبي] مستوى 1' },
  { id: 'l2', name: '[تجريبي] مستوى 2' },
];

/** The five filters as the page hands them over — everything at «الكل». */
const audienceOf = (teachingGroupIds: string[] = []) => ({
  selection: { branchIds: [], categoryIds: [], levelIds: [], groupIds: [], teachingGroupIds },
  setters: SETTERS,
  choices: { levels: CHOICES, groups: CHOICES, circles: CHOICES, levelIdsInPlay: [] },
});
const emptyAudience = audienceOf();

const baseProps = {
  scope: EMPTY_SCOPE,
  locked: false,
  mode: 'multi_dimension',
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
      <ClassSection {...baseProps} audience={emptyAudience} />,
    );
    expect(html).toContain(t('admin.calendar.scopeBranch'));
    expect(html).toContain(t('admin.calendar.scopeCategory'));
    expect(html).toContain(t('admin.calendar.scopeLevel'));
    expect(html).toContain(t('admin.calendar.scopeGroup'));
    expect(html).toContain(t('admin.calendar.scopeCircle'));
    // SRS Revision 165 §8 — the intersection sentence is gone from the form.
    expect(html).not.toContain('تتقاطع فيما بينها');
  });

  it('reads «الكل» on every filter, and never offers a «نمط التدريس» (SRS Revision 163 §5)', () => {
    const html = renderToStaticMarkup(<ClassSection {...baseProps} audience={emptyAudience} />);
    expect(html.split(t('common.all')).length - 1).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain(t('admin.schedules.mode'));
    expect(html).not.toContain(t('admin.schedules.mode_multi_dimension'));
  });

  it('never asks a second branch question beside «فروع» (SRS Revision 165 §6)', () => {
    const html = renderToStaticMarkup(<ClassSection {...baseProps} audience={emptyAudience} />);
    expect(html).not.toContain('الفرع المنظِّم');
  });

  it('every other mode still renders the ordinary branch/Level pair, unaffected', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} mode="entire_level" audience={emptyAudience} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeCircle'));
    expect(html).not.toContain('تتقاطع فيما بينها');
  });

  it('names the chosen circles in the trigger — the one dimension Event never had', () => {
    const html = renderToStaticMarkup(
      <ClassSection
        {...baseProps}
        audience={audienceOf(['l1', 'l2'])}
      />,
    );
    expect(html).toContain('[تجريبي] مستوى 1، [تجريبي] مستوى 2');
  });
});

describe('locked (editing) states the fixed-at-creation notice, never five empty-looking pickers', () => {
  it('renders the same scopeFixed sentence Event\'s own locked scope uses, and no picker', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} locked audience={emptyAudience} />,
    );
    expect(html).toContain(t('admin.calendar.scopeFixed'));
    expect(html).not.toContain(t('admin.calendar.scopeCircle'));
    expect(html).not.toContain('تتقاطع فيما بينها');
  });

  it('every other mode keeps its own existing locked behaviour (the ordinary pair, disabled)', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} mode="entire_level" locked audience={emptyAudience} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeFixed'));
  });
});

const stripped = (raw: string): string => raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const source = stripped(SCHEDULING_SOURCE);
const SESSIONS_SOURCE = stripped(SESSIONS_RAW);
const FILTERS = stripped(FILTERS_RAW);

/**
 * **The submitted payload and the validation rule, pinned against the
 * source.** Mirrors `class-section.scope.test.tsx`'s own "the submitted
 * scope carries every dimension the reader chose, combined" describe
 * block for Events — the same shape, for a class's fifth dimension.
 */
describe('scheduling.tsx wires multi_dimension end to end', () => {

  it('sends dimensions, never target_id, for multi_dimension — the reverse for every other mode', () => {
    expect(source).toContain("...(mode === 'multi_dimension'");
    expect(source).toContain(': { targetId }),');
  });

  it('builds the payload and the create-only rule from the shared module, never a second copy', () => {
    expect(source).toContain('? { dimensions: audienceDimensions(audienceSelection) }');
    expect(source).toContain('if (!editing && !namesATeachingPopulation(audienceSelection)) {');
  });

  it('runs the filters only where they are on screen — a new class, for an administrator', () => {
    expect(source).toContain(
      "const filtering = type === 'class' && mode === 'multi_dimension' && !editing;",
    );
    expect(source).toContain('active: filtering,');
  });

  it('never offers a teaching mode — the actor decides how the audience is stored (SRS Revision 163 §5)', () => {
    expect(source).not.toContain('const MODES');
    // The exam section keeps its own physical/online `onMode`; only the
    // class's teaching-mode setter is gone.
    expect(source).not.toContain('onMode={setMode}');
    expect(source).not.toContain('setMode(');
    expect(source).toContain(
      "const mode = item?.ids.teachingMode ?? (canAssignStaff ? 'multi_dimension' : 'entire_level');",
    );
  });

});

/**
 * **The shared module — one copy of the rule, used by «إضافة عنصر» and by the
 * «from this date onward» editor** (SRS Revision 163 §5).
 */
describe('audience-filters — the payload, the rule, and the narrowing', () => {
  const none = { branchIds: [], categoryIds: [], levelIds: [], groupIds: [], teachingGroupIds: [] };

  it('leaves a filter at «الكل» OUT of the payload — never an empty array to interpret', () => {
    expect(audienceDimensions(none)).toEqual({});
    expect(
      audienceDimensions({ ...none, branchIds: ['b1'], groupIds: ['g1', 'g2'], teachingGroupIds: ['c1'] }),
    ).toEqual({ branchIds: ['b1'], administrativeGroupIds: ['g1', 'g2'], teachingGroupIds: ['c1'] });
  });

  it('holds a class to a real teaching population — a branch or a Category alone names none', () => {
    expect(namesATeachingPopulation(none)).toBe(false);
    expect(namesATeachingPopulation({ ...none, branchIds: ['b1'], categoryIds: ['k1'] })).toBe(false);
    expect(namesATeachingPopulation({ ...none, levelIds: ['l1'] })).toBe(true);
    expect(namesATeachingPopulation({ ...none, groupIds: ['g1'] })).toBe(true);
    expect(namesATeachingPopulation({ ...none, teachingGroupIds: ['c1'] })).toBe(true);
  });

  it('reads every page of groups and circles, narrows child from parent, and drops what is no longer offered', () => {
    expect(FILTERS).toContain('fetchAllPages((page) => listAdministrativeGroups(token, page, {}, null, 100))');
    expect(FILTERS).toContain('fetchAllPages((page) => listCircles(token, page, {}, null, 100))');
    expect(FILTERS).toContain('categoryIds.includes(scope.levelCategoryIds[o.value]');
    expect(FILTERS).toContain('setGroupIds(groupIds.filter((id) => offered.has(id)))');
    // A circle spans branches (Subject + Level only), so a branch never hides it.
    expect(FILTERS).toContain('row.branchId === null || branchIds.includes(row.branchId)');
  });

  it('derives the class\'s own branch from what she already said, in one fixed order', () => {
    const permitted = ['p1', 'p2'];
    // The one branch she chose — whatever else is known.
    expect(homeBranchOf({ branchIds: ['b1'] }, { roomBranchId: 'b9', currentBranchId: 'b8', permitted })).toBe('b1');
    // «الكل»: the chosen room's branch decides.
    expect(homeBranchOf({ branchIds: [] }, { roomBranchId: 'b9', permitted })).toBe('b9');
    // Several: a room (or the class's current branch) inside them wins…
    expect(homeBranchOf({ branchIds: ['b1', 'b2'] }, { roomBranchId: 'b2', permitted })).toBe('b2');
    expect(homeBranchOf({ branchIds: ['b1', 'b2'] }, { currentBranchId: 'b2', permitted })).toBe('b2');
    // …and one OUTSIDE them never does.
    expect(homeBranchOf({ branchIds: ['b1', 'b2'] }, { roomBranchId: 'b9', currentBranchId: 'b8', permitted })).toBe('b1');
    // Nothing chosen, no room: the first branch she may act on; none at all is ''.
    expect(homeBranchOf({ branchIds: [] }, { permitted })).toBe('p1');
    expect(homeBranchOf({ branchIds: [] }, { permitted: [] })).toBe('');
  });

  it('never clears the Level while a chosen group\'s own Level is still unknown', () => {
    // The «from this date onward» editor opens on a group-targeted class with a
    // Subject already chosen; an empty Level pushed before the groups arrive
    // would silently drop that Subject.
    expect(FILTERS).toContain('(groupIds.length > 0 && allGroups.length === 0)');
    expect(FILTERS).toContain('if (!active || awaitingRosters) return;');
  });

  it('is the one module both editors use', () => {
    expect(source).toContain('useAudienceFilters({');
    expect(SESSIONS_SOURCE).toContain('useAudienceFilters({');
    expect(SESSIONS_SOURCE).toContain('<AudienceFilters');
    expect(SESSIONS_SOURCE).not.toContain("t('admin.schedules.mode')");
    expect(SESSIONS_SOURCE).toContain("teaching_mode: 'multi_dimension',");
  });
});

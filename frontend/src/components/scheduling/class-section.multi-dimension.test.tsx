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
    groupId: '', surahId: '',
  },
  set: () => {},
  setMany: () => {},
  options: {
    categoryId: [],
    levelId: [],
    subjectId: [],
    branchId: [],
    academicYearId: [],
    groupId: [], surahId: [],
  },
  loading: {
    categoryId: false,
    levelId: false,
    subjectId: false,
    branchId: false,
    academicYearId: false,
    groupId: false, surahId: false,
  },
  ready: true,
  levelTeachesNothing: false,
  wholeCategoryOptions: [],
  wholeCategoryTeachesNothing: false,
  subjectsIndependentOfLevel: false,
  teacherHonorific: '',
  levelCategoryIds: {},
  levelNames: {},
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
  choices: {
    levels: CHOICES,
    groups: CHOICES.map((c) => ({ ...c, label: c.name })),
    circles: CHOICES.map((c) => ({ ...c, label: c.name })),
    levelIdsInPlay: [],
  },
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

describe('R176 §2 — editing a multi_dimension class shows the five pickers, seeded from the row', () => {
  it('renders the circle picker on edit; the fixed-at-creation sentence is gone', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} locked audience={emptyAudience} />,
    );
    expect(html).not.toContain('النطاق يُحدَّد عند الإنشاء');
    expect(html).toContain(t('admin.calendar.scopeCircle'));
  });

  it('every other mode keeps its own existing locked behaviour (the ordinary pair, disabled)', () => {
    const html = renderToStaticMarkup(
      <ClassSection {...baseProps} mode="entire_level" locked audience={emptyAudience} />,
    );
    expect(html).not.toContain(t('admin.calendar.scopeCircle'));
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
    expect(source).toContain(': { dimensions: audienceDimensions(audienceSelection) }');
    // R169 §7 — the create-only «needs a Level» pre-check is GONE: «الكل» on
    // Level, group and circle is a real answer (every Level teaching the
    // Subject), so the form refuses nothing here and the server's one refusal
    // (`NO_LEVEL_TEACHES_SUBJECT`) has its own sentence.
    expect(source).not.toContain('!namesATeachingPopulation(audienceSelection)');
    expect(source).toContain("NO_LEVEL_TEACHES_SUBJECT: 'admin.schedules.noLevelTeachesSubject'");
    expect(source).toContain("subjectsTaughtAnywhere: type === 'class' && mode === 'multi_dimension' && !editing,");
  });

  it('says what «الكل» on all three MEANS, exactly when nothing names a population', () => {
    expect(FILTERS_RAW).toContain('{namesATeachingPopulation(selection) ? null : (');
    expect(FILTERS_RAW).toContain("t('admin.calendar.scopeEveryLevelHint')");
  });

  it('runs the filters only where they are on screen — a multi_dimension class, new or edited (R176 §2)', () => {
    expect(source).toContain("const filtering = type === 'class' && mode === 'multi_dimension';");
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

  it('knows when a selection names a teaching population — what the «الكل» hint and the per-occurrence override read', () => {
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
    // R179 §4 (Owner-reported, 2026-09-29) — a circle has a branch since R172
    // §15, and the picker read it as `null`, so «مقر أمرشيش» offered every
    // branch's circles. Its own branch now, and a circle from before the
    // column answers no branch filter — the rule «حلقات المواد» applies.
    expect(FILTERS).toContain('branchId: c.branch_id ?? null,');
    expect(FILTERS).toContain("(row.branchId !== null && branchIds.includes(row.branchId))");
    expect(FILTERS).not.toContain('branchId: null }');
  });

  it('R179 §4/§5 — a circle is named by its Subject, a group by its Level, both by their branch once the offer spans more than one', () => {
    // The picker shows `label`; the composed title keeps reading `name` («الحلقة 1»).
    expect(FILTERS).toContain("label: [r.name, middle(r), spansBranches ? branchOf(r) : null]");
    expect(FILTERS).toContain("(g) => scope.levelNames[g.levelId],");
    expect(FILTERS).toContain("labelled(circleChoices, (c) => c.subjectName, (c) => c.branchName)");
    expect(FILTERS).toContain("options={choices.groups.map((g) => ({ value: g.id, label: g.label }))}");
    expect(FILTERS).toContain("options={choices.circles.map((c) => ({ value: c.id, label: c.label }))}");
    expect(SCHEDULING_SOURCE).toContain("`الحلقة ${audienceChoices.circles.find((c) => teachingGroupIds.includes(c.id))!.name}`");
    expect(SCHEDULING_SOURCE).toContain("audienceChoices.groups.find((g) => groupIds.includes(g.id))?.name ?? null");
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

  it('R179 §8 — never prunes the seeded Levels before the Level list has arrived (an edit kept its Level; the untouched form is not dirty)', () => {
    expect(FILTERS).toContain('if (!active || !scope.ready) return;\n    const offered = new Set(levelChoices.map((o) => o.value));');
    expect(FILTERS).toContain('}, [active, scope.ready, levelChoices, levelIds, setLevelIds]);');
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

/**
 * **R179 §3 (Owner-reported, 2026-09-29) — «تعديل العنصر» shows and keeps
 * the row's own Subject.** She removed the assigned teacher, saved, and was
 * refused with «اختاري المادة.» — the frozen Subject had gone blank: the
 * hook clears its Subject whenever its Level moves, and a filter-built
 * class's representative Level moves once its circles load. The Subject is
 * never sent on an edit, so the form now reads it from the ROW: pinned on
 * the control, and read from the row by the completeness rule.
 */
describe('R179 §3 — the frozen Subject is the row\'s, not the hook\'s', () => {
  it('shows the row\'s Subject, disabled, although the hook holds none', () => {
    const html = renderToStaticMarkup(
      <ClassSection
        {...baseProps}
        locked
        frozenSubject={{ value: 's1', label: '[تجريبي] أحكام التجويد' }}
        audience={audienceOf(['l1'])}
      />,
    );
    expect(html).toContain('[تجريبي] أحكام التجويد');
    expect(html).toMatch(/<select[^>]*disabled[^>]*>(?:(?!<\/select>).)*\[تجريبي\] أحكام التجويد/s);
  });

  it('on create the control is the hook\'s, and a pin is never applied', () => {
    const html = renderToStaticMarkup(
      <ClassSection
        {...baseProps}
        frozenSubject={{ value: 's1', label: '[تجريبي] أحكام التجويد' }}
        audience={emptyAudience}
      />,
    );
    expect(html).not.toContain('[تجريبي] أحكام التجويد');
  });

  it('the page pins the row\'s Subject on edit and asks for one only from what the row or the hook holds', () => {
    expect(SCHEDULING_SOURCE).toContain(
      "? { value: item.ids.subjectId, label: item.subjectName ?? '' }",
    );
    expect(SCHEDULING_SOURCE).toContain(
      "if (surahSubjectId === '' || surahSubjectId === ALL_SUBJECTS) return t('scheduling.invalid.subject');",
    );
    expect(SCHEDULING_SOURCE).toContain("if (!editing && scope.levelTeachesNothing) return t('scope.assignSubjectsHint');");
    expect(SCHEDULING_SOURCE).not.toContain("if (scope.value.subjectId === '') return t('scheduling.invalid.subject');\n      // R178 §6(a)");
  });

  it('R195 — «كل المواد» is offered where the audience is a Level or a group and no circle, sent as null, and pinned on edit', () => {
    // The rule the server holds (`SUBJECT_REQUIRED_FOR_AUDIENCE`), stated once here.
    expect(SCHEDULING_SOURCE).toContain(
      "(mode === 'multi_dimension' &&\n        (levelIds.length > 0 || groupIds.length > 0) &&\n        teachingGroupIds.length === 0)",
    );
    expect(SCHEDULING_SOURCE).toContain('subjectId: classOfAllSubjects ? null : scope.value.subjectId,');
    expect(SCHEDULING_SOURCE).toContain(": { value: ALL_SUBJECTS, label: t('scheduling.subjectAll') }");
    // The hook keeps the sentinel: rule 2 would otherwise clear it as a stale id.
    expect(SCHEDULING_SOURCE).toContain('sentinels: { subjectId: [ALL_SUBJECTS] },');
    expect(t('scheduling.subjectAll')).toBe('كل المواد');
    expect(t('scheduling.subjectAllHint')).not.toBe('scheduling.subjectAllHint');
  });
});

/**
 * **R179 §12 (Owner, 2026-09-29) — the form says what an edit reaches.** A
 * class whose last date has passed changes its card alone; any other edit
 * reaches the coming occurrences only, never the past (§4.4, R43.4).
 */
describe('R179 §12 — what an edit reaches is said on the form', () => {
  it('a series with an end before today, or a one-off before today, has ended; an open series never has', async () => {
    const { classHasEnded } = await import('../../pages/admin/scheduling.js');
    expect(classHasEnded({ recurrence: 'weekly', startDate: '2026-09-01', repeatUntil: '2026-09-25' }, '2026-09-29')).toBe(true);
    expect(classHasEnded({ recurrence: 'weekly', startDate: '2026-09-01', repeatUntil: '2026-10-25' }, '2026-09-29')).toBe(false);
    expect(classHasEnded({ recurrence: 'weekly', startDate: '2026-09-01', repeatUntil: null }, '2026-09-29')).toBe(false);
    expect(classHasEnded({ recurrence: 'none', startDate: '2026-09-21', repeatUntil: null }, '2026-09-29')).toBe(true);
    expect(classHasEnded({ recurrence: 'none', startDate: '2026-09-29', repeatUntil: null }, '2026-09-29')).toBe(false);
  });

  it('the notice is rendered on edit of a class, in one of its two forms', () => {
    expect(SCHEDULING_SOURCE).toContain("{type === 'class' && editing && item ? (");
    expect(SCHEDULING_SOURCE).toContain("classHasEnded(item, iso(new Date())) ? 'scheduling.editReach.ended' : 'scheduling.editReach.future'");
  });
});

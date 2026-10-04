import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Branch } from '../adapters/branches-admin.js';
import { listAdministrativeGroups, type AdministrativeGroup } from '../adapters/administrative-groups.js';
import type { AcademicYearRef } from '../adapters/reference-data.js';
import type { Category, Level } from '../adapters/taxonomy.js';
import { fetchCourseScheduleOptions, fetchScopeOptions } from '../adapters/scope-options.js';
import type { SubjectRef } from '../adapters/reference-data.js';
import { levelLabel } from '../components/scope/level-select.js';
import { t } from '../i18n/index.js';
import { facetsOf, reconcile, type FacetFacts, type FacetOptions } from './scope-facets.js';

/**
 * **The curriculum's dependency graph, in one place.**
 *
 * ## The defect this exists for
 *
 * Every selector on every screen was independent: a form offered all 21 Levels
 * and all 3 Subjects and let the administrator pick any pair, and the server —
 * which knows that a Subject belongs to a Level only through `LevelSubject`
 * (§4.4b, R43) — refused the ones that do not exist with `SUBJECT_NOT_AT_LEVEL`.
 * **The interface was offering combinations the domain does not contain**, and
 * then reporting them as the user's mistake.
 *
 * The fix cannot be per-screen. Six screens ask overlapping versions of the same
 * question, and six copies of "when the Level changes, reload the Subjects and
 * clear the stale one" is exactly the duplication that drifts — the copy that
 * forgets to clear still passes its own tests. So the graph is expressed **once,
 * here**, and screens choose which of its fields to render.
 *
 * ## The graph, as §7 defines it
 *
 * ```
 * Category ──< Level ──< LevelSubject >── Subject
 *                 │
 *                 └──< AdministrativeGroup >── Branch
 * ```
 *
 * * A **Level** belongs to exactly one Category, so choosing a Category narrows
 *   the Levels.
 * * A **Subject** reaches a Level only through `LevelSubject`. There is no
 *   "subjects in general" for a chosen Level — a Level that teaches nothing has
 *   an empty list, and that is a true statement about the curriculum rather than
 *   a loading state.
 * * An **Administrative Group** is a roster *at a premises*, so it is determined
 *   by Level **and** Branch together (§4.4c) — neither alone narrows it.
 * * An **Academic Year** depends on nothing. It is deliberately not chained: the
 *   platform's years are global (§4.10), and inventing a dependency to make the
 *   set look uniform would be a lie about the model.
 *
 * ## Two rules this enforces that a screen must never re-implement
 *
 * 1. **Changing a parent reloads every child.** Not just the next one — a Level
 *    change invalidates Subjects *and* Groups.
 * 2. **A selection that is no longer offered is cleared, not kept.** A stale id
 *    left in state is precisely what reaches the server as an impossible pair;
 *    clearing it is what makes "the UI cannot express an invalid combination"
 *    true rather than aspirational.
 */

export interface ScopeValue {
  /** `''` is *unset*. Never `null`: a `<select>` carries strings, and one
   *  representation of "nothing chosen" is what keeps the resets simple. */
  categoryId: string;
  levelId: string;
  subjectId: string;
  branchId: string;
  academicYearId: string;
  groupId: string;
  /** R198 §3 — one Surah (its number, as a string). Narrows the Levels whose
   *  syllabus holds it and the Subjects taught by Surah; is narrowed by them. */
  surahId: string;
}

export type ScopeField = keyof ScopeValue;

export interface Option {
  value: string;
  label: string;
}

export const EMPTY_SCOPE: ScopeValue = {
  categoryId: '',
  levelId: '',
  subjectId: '',
  branchId: '',
  academicYearId: '',
  groupId: '',
  surahId: '',
};

export interface ScopeOptions {
  value: ScopeValue;
  /** Sets one field. Children are reloaded and stale selections cleared by the
   *  effects below — a caller never does either itself. */
  set: (field: ScopeField, next: string) => void;
  setMany: (patch: Partial<ScopeValue>) => void;
  options: Record<ScopeField, Option[]>;
  /** A field whose options are still loading. Rendered as `busy` rather than
   *  hidden, so the row does not reflow and the wait is announced (§14.4). */
  loading: Record<ScopeField, boolean>;
  /** True once the independent lists have arrived — the point at which an empty
   *  option list means *empty*, not *not yet*. */
  ready: boolean;
  /** The chosen Level teaches no Subjects. A real curriculum state, and the one
   *  a screen must explain rather than present as an empty dropdown. */
  levelTeachesNothing: boolean;
  /** R172 §1 — `category:<id>` choices for the Level control, one per Category
   *  some Subject is taught WHOLE; empty where none is. */
  wholeCategoryOptions: Option[];
  /** «كل مستويات الفئة» is chosen and the Category is taught no Subject whole. */
  wholeCategoryTeachesNothing: boolean;
  /** True while the Subject control may be used with no Level in play. */
  subjectsIndependentOfLevel: boolean;
  /** R172 §12 — the server's word before a teacher's name in a composed title. */
  teacherHonorific: string;
  /**
   * **Level id → its Category id** (SRS Revision 163 §5). `options.levelId`
   * carries labels only, and a form whose Category filter holds SEVERAL values
   * cannot use the single-valued `value.categoryId` chain to narrow its Levels —
   * it narrows them itself, from this.
   */
  levelCategoryIds: Record<string, string>;
  /** Level id → its bare name (R179 §5) — for a label that already says the
   *  Category elsewhere, or none at all («1 — كتاكيت الأمل — مقر تاركة»). */
  levelNames: Record<string, string>;
  /**
   * **SRS Revision 165 §2 — what a form needs to ask «أي سورة؟».** Which
   * Subjects work by Surah (a column the server sends — never a Subject's
   * name), each Level's «مقرر الحفظ», and the Surahs' names. All three come
   * from the one scope read, so a مؤطِّرة scheduling her own class has them too.
   */
  subjectsBySurah: ReadonlySet<string>;
  levelSurahIds: Record<string, number[]>;
  surahNames: Record<number, string>;
  /** §4.9's default content visibility for the chosen Level, through its
   *  Category (§15.1). `null` when no Level is chosen or the lists have not
   *  arrived — never guessed, and never `public` on absence. */
  defaultVisibility: 'public' | 'private' | 'hidden' | null;
  /**
   * **R123 — may beneficiaries of the chosen Level's Category record their own
   * presence?** `null` when no Level is chosen or the lists have not arrived —
   * never guessed, and **never `true` on absence**: offering self check-in for
   * a population the server refuses is the misleading control this exists to
   * prevent.
   */
  selfAttendanceAllowed: boolean | null;
}

export interface UseScopeOptionsInput {
  token: string | null;
  /** Only these are fetched. A screen that shows no Branch selector should not
   *  make an Admin-only branch request it will never render. */
  fields: readonly ScopeField[];
  initial?: Partial<ScopeValue>;
  /** Default the Academic Year to the live one (`is_current`), which is the year
   *  nearly every write belongs to. Off for filter bars, where defaulting a
   *  filter silently hides rows. */
  defaultCurrentYear?: boolean;
  /**
   * **Subsumed by R198 §3** — every form now offers the Subjects some Level
   * teaches with no Level chosen. Accepted, and ignored, for its callers.
   *
   * **A form in which «no Level» is a real answer** (SRS Revision 169 §7).
   *
   * A class may be addressed to «الكل» — every Level that teaches its Subject —
   * so its form must let a Subject be chosen with no Level in play. What is
   * offered then is every Subject SOME Level teaches (never the whole catalogue:
   * a Subject no Level teaches has nobody to reach, and the server refuses it,
   * `NO_LEVEL_TEACHES_SUBJECT`), and clearing the Level keeps the Subject, as a
   * filter does, because the pair is valid here. Off by default: every other
   * form still holds no Subject without a Level.
   */
  subjectsTaughtAnywhere?: boolean;
  /**
   * R172 §1 — offer «{الفئة} — كل مستويات الفئة» IN the Level list (as
   * `category:<id>`), every Category when none is chosen and the chosen one
   * alone when one is. In the list itself, not beside it: rule 2 clears a
   * Level value the list does not hold, so a choice offered from outside was
   * dropped the moment it was made. Off by default; the content scope asks.
   */
  offerWholeCategory?: boolean;
  /**
   * **R195 — values a field may hold that are not rows of its table**, and
   * that rule 2 must therefore not clear: the scheduling form's «كل المواد»
   * on the Subject (`'*'`). The matching option is the caller's to render
   * (`ScopeSelectors`'s `extraOptions`); this only says the value is legal.
   */
  sentinels?: Partial<Record<ScopeField, readonly string[]>>;
  /**
   * **Whether these selectors narrow a list or fill a form** (2026-08-18).
   *
   * This replaced a `subjectsUnscoped` boolean, and the reason is the defect that
   * boolean produced: it was **opt-in per caller**, so `مكتبة المحتوى` got it and
   * `الجدولة` did not — one screen right, the next wrong, which is the drift this
   * hook exists to prevent.
   *
   * `mode` is a fact the caller **already knows and already passes to
   * `ScopeSelectors`**, so passing it here is stating one thing once rather than
   * remembering a second thing. A guard asserts the two agree.
   *
   * | | `form` (default) | `filter` |
   * |---|---|---|
   * | Subject with no Level | **empty** — offering one the Level does not teach is offering `SUBJECT_NOT_AT_LEVEL` (§4.4b) | **every Subject** — *"everything about تفسير"* is a legitimate question |
   * | Clearing the Level | clears the Subject — with no Level there is no valid Subject to hold | **keeps** it — widening a question is not retracting half of it |
   *
   * Defaulting to `form` is the safe direction: a caller that forgets it gets the
   * stricter behaviour, never a pair the server refuses.
   */
  mode?: 'form' | 'filter';
  /**
   * **SRS §2, Revision 140 — read her own declared-capability scope, not the
   * platform's whole curriculum vocabulary.**
   *
   * `false` (the default) preserves this hook's existing behaviour for every
   * existing caller, unchanged: `/me/scope-options`, deliberately UNSCOPED on
   * the curriculum axes (§4.9 tier 3 — every staff member reads every content
   * tier). `true` switches the ONE fetch this hook makes to
   * `/me/course-schedule-options` instead, which narrows Levels/Subjects to
   * what a مؤطِّرة has actually declared and Branches to her `teacher`
   * `UserBranchRole` — see that endpoint's own docstring for why this is a
   * second read rather than a flag threaded onto the first.
   *
   * Branches by an Admin's own scope are UNCHANGED either way: an Admin never
   * passes this, so `ClassSection`'s one shared scope chain serves both
   * callers correctly from the same hook.
   */
  restrictToOwnCapability?: boolean;
}

/**
 * A **content** key for a field list, so two arrays holding the same fields are
 * the same dependency however they were constructed.
 *
 * Sorted, because `['a','b']` and `['b','a']` request the same data and must not
 * re-fetch; exported so the property can be tested directly rather than
 * inferred from a render count.
 */
/** A Level's place in the Super Admin's order (the levels arrive in it). */
function levelRank(levels: readonly Level[], levelId: string): number {
  const at = levels.findIndex((l) => l.id === levelId);
  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
}

export function scopeFieldKey(fields: readonly ScopeField[]): string {
  return [...fields].sort().join(',');
}

export function useScopeOptions({
  token,
  fields,
  initial,
  defaultCurrentYear = false,
  mode = 'form',
  restrictToOwnCapability = false,
  offerWholeCategory = false,
  sentinels = {},
}: UseScopeOptionsInput): ScopeOptions {
  const subjectsUnscoped = mode === 'filter';
  /**
   * **The field list is depended on by CONTENT, never by identity.**
   *
   * This is the bug that took `/admin/schedules` down, and it is worth stating
   * in full because the shape recurs:
   *
   * 1. a caller passed `fields` as an inline array literal, so it was a new
   *    reference on every render;
   * 2. `wants` was a `useCallback` keyed on that array, so it too was new;
   * 3. the loading effects below depend on `wants`, so they re-ran;
   * 4. they called `setCategories`/`setLevels`/`setBranches`/`setYears`, which
   *    re-rendered — back to 1, forever.
   *
   * The requests then failed, which looked like a server fault and was not:
   * the loop tripped Nginx's per-IP edge limit (TD-13, 120 r/m with burst 20),
   * so the rate limiter was working correctly against a client defect.
   *
   * **Every other caller happened to pass a module constant**, which is exactly
   * why this survived review — the convention hid a hook that was a landmine
   * for anyone who did the obvious thing. Keying on the *content* removes the
   * question: an inline literal and a shared constant now behave identically,
   * so a caller cannot get this wrong.
   */
  const fieldKey = scopeFieldKey(fields);
  const wants = useCallback(
    (field: ScopeField) => fieldKey.split(',').includes(field),
    [fieldKey],
  );

  const [value, setValue] = useState<ScopeValue>({ ...EMPTY_SCOPE, ...initial });

  const [categories, setCategories] = useState<Category[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  /** R172 §1 — the Subjects taught to a WHOLE Category, by Category id. */
  const [categorySubjects, setCategorySubjects] = useState<Map<string, string[]>>(new Map());
  const [teacherHonorific, setTeacherHonorific] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [years, setYears] = useState<AcademicYearRef[]>([]);
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  /** NEW D — every Subject, and each Level's own Subjects, from the one read.
   *  The narrowing below is a lookup rather than a second (Admin-only) request. */
  const [allSubjects, setAllSubjects] = useState<SubjectRef[]>([]);
  const [levelSubjects, setLevelSubjects] = useState<Map<string, string[]>>(new Map());
  // R165 §2 — one state, because the three always arrive (and change) together.
  const [surahFacts, setSurahFacts] = useState<{
    subjectsBySurah: ReadonlySet<string>;
    levelSurahIds: Record<string, number[]>;
    surahNames: Record<number, string>;
  }>({ subjectsBySurah: new Set(), levelSurahIds: {}, surahNames: {} });

  const [ready, setReady] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Levels are needed whenever a Category, Level or Group is offered: a Category
  // narrows Levels, and a Group is reached through one.
  const needsLevels = wants('categoryId') || wants('levelId') || wants('groupId');

  /* ── The independent lists, once ──────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /**
       * **One caller-scoped read, not four admin ones** (NEW D).
       *
       * This hook is shared by مكتبة المحتوى, الجدولة, the groups screen and
       * the upload form, and it used to assemble its vocabulary from
       * `/admin/categories`, `/admin/levels`, `/admin/branches` and
       * `/admin/academic-years`. Three of those answer **403** for a مؤطِّرة by
       * design (R30), so every screen this hook serves opened for her with a
       * half-dead filter row — **the wrong layer was here, not the page.**
       *
       * `GET /me/scope-options` answers the narrower question *what may I
       * filter and compose by*, per caller, and the admin reads are untouched
       * and still refuse her (R93.4's precedent and mechanism).
       *
       * The fields are still requested conditionally in spirit — the hook uses
       * only what the caller `wants` — but there is nothing to save by asking
       * for less of one small payload, and asking for all of it is what lets
       * the Level → Subject narrowing be a lookup instead of a second request.
       */
      const payload = await (restrictToOwnCapability
        ? fetchCourseScheduleOptions(token)
        : fetchScopeOptions(token));
      if (cancelled) return;
      // `/me/scope-options` is a SELECTOR payload and deliberately narrower than
      // the management one: it carries what a dropdown needs. The fields below
      // are placeholders for what it does not send — `description: null` here
      // means *this payload does not carry one*, not *this row has none*, which
      // is why nothing in a selector renders it.
      const cats: Category[] = payload.categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: null,
        holds_own_login: null,
        min_age: null,
        max_age: null,
        display_order: null,
        level_count: 0,
        subject_ids: c.subject_ids ?? [],
        version: 0,
      }));
      const lvls: Level[] = payload.levels.map((l) => ({
        id: l.id,
        name: l.name,
        description: null,
        category_id: l.category_id,
        category_name: l.category_name,
        default_visibility: l.default_visibility,
        gender_restriction: 'any',
        // R180 §4/§6 — not carried by `/me/scope-options`; a form reads none.
        min_age: null,
        max_age: null,
        journey_role: 'step',
        memorisation_hizb: null,
        display_order: null,
        group_count: 0,
        // R183 §6 — not carried by `/me/scope-options` either.
        surah_ids: [],
        subject_count: l.subject_ids.length,
        subject_ids: l.subject_ids,
        enrollment_count: 0,
        version: 0,
      }));
      const brs: Branch[] = payload.branches.map((b) => ({ id: b.id, name: b.name }) as Branch);
      const yrs: AcademicYearRef[] = payload.academic_years.map((y) => ({
        id: y.id,
        label: y.label,
        is_current: y.is_current,
        // This narrower `/me/scope-options` read carries no real TD-15
        // coordinate — nobody edits a year from here — matching `Level`'s own
        // placeholder above.
        version: 0,
      }));
      setLevelSubjects(
        new Map(payload.levels.map((l) => [l.id, l.subject_ids])),
      );
      setCategorySubjects(new Map(payload.categories.map((c) => [c.id, c.subject_ids ?? []])));
      setTeacherHonorific(payload.teacher_honorific ?? '');
      setAllSubjects(payload.subjects.map((x) => ({ id: x.id, name: x.name }) as SubjectRef));
      setSurahFacts({
        subjectsBySurah: new Set(
          payload.subjects.filter((x) => x.requires_surahs === true).map((x) => x.id),
        ),
        levelSurahIds: Object.fromEntries(payload.levels.map((l) => [l.id, l.surah_ids ?? []])),
        surahNames: Object.fromEntries((payload.surahs ?? []).map((x) => [x.id, x.name])),
      });
      setCategories(cats);
      setLevels(lvls);
      setBranches(brs);
      setYears(yrs);
      if (defaultCurrentYear) {
        const current = yrs.find((y) => y.is_current);
        if (current) setValue((v) => (v.academicYearId === '' ? { ...v, academicYearId: current.id } : v));
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, wants, needsLevels, defaultCurrentYear, restrictToOwnCapability]);

  /**
   * **Every list is derived during render from the one read** (NEW D; R198
   * §3), never written to state by an effect: as an effect, `options` was
   * once memoised from an empty list in the very commit `ready` flipped true,
   * and rule 2 cleared a Subject the caller had deliberately seeded. Derived
   * in the same pass from the same data, the two cannot disagree.
   *
   * What each list offers is `scope-facets.ts`'s rule: with nothing else
   * chosen a FILTER offers every Subject (Owner, 2026-08-17 — «everything
   * about تفسير» is a fair question) and a FORM every Subject some Level
   * teaches; whatever is chosen narrows the rest.
   */
  /* ── Groups: every one the caller may read, once (R198 §3) ─────────────── */
  //
  // A group is a roster of one Level at one premises (§4.4c). Until R198 the
  // list was requested only once a Level AND a Branch were both chosen; it is
  // now read whole (pages of the TD-10 maximum) and narrowed here by whatever
  // is chosen — and choosing a group sets its Level, Category and Branch.
  useEffect(() => {
    if (!wants('groupId')) return;
    let cancelled = false;
    setLoadingGroups(true);
    void (async () => {
      try {
        const all: AdministrativeGroup[] = [];
        for (let page = 1; ; page += 1) {
          const batch = await listAdministrativeGroups(token, page, {}, null, 100);
          all.push(...batch.data);
          if (batch.data.length < 100 || all.length >= batch.meta.total) break;
        }
        if (!cancelled) setGroups(all);
      } catch {
        // A caller the group read refuses simply has no group to offer.
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, wants]);

  /**
   * **The facts every list is narrowed by, and the rules that narrow them**
   * (`scope-facets.ts`). Held in a ref too, so `set` — which must stay
   * referentially stable (see `fields` above) — reads the current ones.
   */
  const facts = useMemo<FacetFacts>(
    () => ({
      categoryIds: categories.map((c) => c.id),
      levels,
      subjectIds: allSubjects.map((x) => x.id),
      levelSubjects,
      categorySubjects,
      levelSurahIds: surahFacts.levelSurahIds,
      subjectsBySurah: surahFacts.subjectsBySurah,
      // Ordered by the Level's place (the Super Admin's), then the group's own.
      groups: [...groups].sort((a, b) => levelRank(levels, a.level_id) - levelRank(levels, b.level_id)),
    }),
    [categories, levels, allSubjects, levelSubjects, categorySubjects, surahFacts, groups],
  );
  const facetOptions = useMemo<FacetOptions>(
    () => ({ subjectsUnscoped, offerWholeCategory, sentinels }),
    // `sentinels` is a literal at most call sites: compared by content.
    [subjectsUnscoped, offerWholeCategory, JSON.stringify(sentinels)],
  );
  const facets = useMemo(() => facetsOf(value, facts, facetOptions), [value, facts, facetOptions]);
  const factsRef = useRef({ facts, facetOptions });
  factsRef.current = { facts, facetOptions };

  /* ── The option lists ─────────────────────────────────────────────────── */
  const options = useMemo((): Record<ScopeField, Option[]> => {
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const levelById = new Map(levels.map((l) => [l.id, l]));
    const subjectName = new Map(allSubjects.map((x) => [x.id, x.name]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    return {
      categoryId: facets.categoryId.map((id) => ({ value: id, label: categoryName.get(id) ?? '' })),
      // One label for a Level everywhere (`{Category} — {Level}`): a Level name
      // is not unique across Categories and not numbered uniformly (§4.4b), so
      // the bare name genuinely fails to identify one. Shared with the atomic
      // selector rather than spelled out again here. R172 §1's whole-Category
      // choices lead the list.
      levelId: facets.levelId.map((id) => {
        const whole = wholeCategoryOf(id);
        if (whole !== null) return { value: id, label: `${categoryName.get(whole) ?? ''} — ${t('scope.wholeCategory')}` };
        const level = levelById.get(id);
        return { value: id, label: level ? levelLabel(level) : '' };
      }),
      subjectId: facets.subjectId.map((id) => ({ value: id, label: subjectName.get(id) ?? '' })),
      branchId: branches.map((b) => ({ value: b.id, label: b.name })),
      academicYearId: years.map((y) => ({ value: y.id, label: y.label })),
      groupId: facets.groupId.map((id) => {
        const group = groupById.get(id);
        const level = group ? levelById.get(group.level_id) : undefined;
        // A group's name is not unique across Levels: the Level says which,
        // unless the Level is the one chosen.
        return {
          value: id,
          label: group === undefined ? '' : level && value.levelId !== level.id ? `${level.name} — ${group.name}` : group.name,
        };
      }),
      surahId: facets.surahId.map((id) => ({
        value: id,
        label: surahFacts.surahNames[Number(id)] ?? id,
      })),
    };
  }, [facets, categories, levels, allSubjects, branches, years, groups, surahFacts.surahNames, value.levelId]);

  /* ── Rule 2: a selection no longer offered is CLEARED ─────────────────── */
  //
  // This is the whole point of the module. A stale id kept in state is exactly
  // what reaches the server as an impossible pair, and clearing it here — rather
  // than in each screen's change handler — is what makes the guarantee real.
  //
  // Guarded on `ready` and on the per-field loading flags: clearing against a
  // list that has not arrived would wipe an `initial` value the caller passed in
  // deliberately (an edit form opening on an existing row).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sentinelsRef = useRef(sentinels);
  sentinelsRef.current = sentinels;

  useEffect(() => {
    if (!ready) return;
    setValue((current) => {
      const next = { ...current };
      let changed = false;
      // Checked as the hierarchy reads (Category → Level → Subject → Surah),
      // never a parent against its child: a seeded edit whose Level and
      // Subject disagree loses the Subject, as it always has, not the Level.
      const { facts: f, facetOptions: o } = factsRef.current;
      const allowed = (field: ScopeField): readonly string[] => {
        if (field === 'categoryId') return f.categoryIds;
        if (field === 'levelId') return facetsOf({ ...next, subjectId: '', surahId: '', groupId: '' }, f, o).levelId;
        if (field === 'subjectId') return facetsOf({ ...next, surahId: '', groupId: '' }, f, o).subjectId;
        if (field === 'surahId') return facetsOf({ ...next, groupId: '' }, f, o).surahId;
        if (field === 'groupId') return facetsOf(next, f, o).groupId;
        return optionsRef.current[field].map((x) => x.value);
      };
      const drop = (field: ScopeField, blocked: boolean): void => {
        if (blocked) return;
        const chosen = next[field];
        if (chosen === '') return;
        // R195 — a sentinel the caller declared is a legal value, not a stale id.
        if (sentinelsRef.current[field]?.includes(chosen)) return;
        if (!allowed(field).includes(chosen)) {
          next[field] = '';
          changed = true;
        }
      };
      drop('categoryId', false);
      drop('levelId', false);
      drop('subjectId', !wants('subjectId'));
      drop('surahId', !wants('surahId'));
      drop('branchId', false);
      drop('academicYearId', false);
      // A list still arriving is left alone: clearing on the way there would
      // blank a valid seeded group every time.
      drop('groupId', loadingGroups || !wants('groupId'));
      return changed ? next : current;
    });
  }, [options, ready, loadingGroups, wants]);

  /**
   * **One field changed: the others follow** (R198 §3, `reconcile`). A Level
   * sets its Category, a Group its Level and Branch, clearing the Category
   * retracts its Level, and whatever the new combination no longer offers is
   * cleared at the source, so no frame shows a stale pair. Reads the facts
   * through a ref, so `set` stays referentially stable — a `useCallback`
   * keyed on them would re-run every effect that depends on it.
   */
  const set = useCallback((field: ScopeField, next: string) => {
    setValue((current) => {
      if (current[field] === next) return current;
      if (field === 'academicYearId') return { ...current, academicYearId: next };
      const { facts: f, facetOptions: o } = factsRef.current;
      const { academicYearId, ...rest } = current;
      const updated = reconcile(rest, field, next, f, o);
      return { ...updated, academicYearId };
    });
  }, []);

  const setMany = useCallback((patch: Partial<ScopeValue>) => {
    setValue((current) => ({ ...current, ...patch }));
  }, []);

  // What the chosen Level (or whole Category) teaches at all — whatever the
  // Surah: «this Level teaches nothing» is about the curriculum, not a filter.
  const taughtAtChosen =
    value.levelId === ''
      ? null
      : facetsOf({ ...value, subjectId: '', surahId: '', groupId: '' }, facts, facetOptions).subjectId.length;

  return {
    value,
    set,
    setMany,
    options,
    loading: {
      categoryId: !ready,
      levelId: !ready,
      subjectId: !ready,
      branchId: !ready,
      academicYearId: !ready,
      groupId: loadingGroups,
      surahId: !ready,
    },
    ready,
    levelTeachesNothing:
      wants('subjectId') && ready && wholeCategoryOf(value.levelId) === null && value.levelId !== '' && taughtAtChosen === 0,
    levelCategoryIds: Object.fromEntries(levels.map((l) => [l.id, l.category_id])),
    levelNames: Object.fromEntries(levels.map((l) => [l.id, l.name])),
    /**
     * R172 §1 — the whole-Category choices a Level control may offer beside
     * its Levels (only Categories some Subject is taught WHOLE), and the
     * Subjects each carries.
     */
    // The whole-Category choices the Level list holds when asked for
    // (`offerWholeCategory`): every Category when none is chosen, the chosen
    // one alone when one is — ALWAYS offered (the Owner, 2026-09-23: she
    // could not find the choice at all while no Subject was assigned to the
    // Category whole; the choice now leads to the hint that says so).
    wholeCategoryOptions: options.levelId.filter((o) => wholeCategoryOf(o.value) !== null),
    /** True while «كل مستويات الفئة» is chosen and that Category is taught no Subject whole. */
    wholeCategoryTeachesNothing:
      wants('subjectId') && ready && wholeCategoryOf(value.levelId) !== null && taughtAtChosen === 0,
    /** Always true since R198 §3: a Subject may be chosen first, and narrows
     *  the Levels in turn. Kept for the callers that read it. */
    subjectsIndependentOfLevel: true,
    teacherHonorific,
    ...surahFacts,
    /**
     * §4.9's default content visibility for the currently chosen Level, through
     * its Category (§15.1) — `null` until both lists have arrived.
     *
     * Resolved here rather than on the screen because the Level → Category hop
     * is the same one `categoryDefaultVisibility` makes on the server, and a
     * screen re-deriving it would be a second answer to one question.
     */
    defaultVisibility: defaultVisibilityForLevel(levels, value.levelId),
    selfAttendanceAllowed: selfAttendanceAllowedForLevel(levels, value.levelId),
  };
}

/**
 * The chosen Level's §15.1 default, resolved server-side and carried on the
 * Level itself.
 *
 * **Read from the Level, not from the Category.** The screens that scope an
 * upload load Levels; `/admin/categories` is Admin-only (TD-2 R26, R30) and the
 * content page never requests it, so resolving through a Category list would
 * have produced `null` on every screen that needs this and left the selector
 * inert — the same defect in a new place.
 */
/**
 * R172 §1 — «كل مستويات الفئة» travels in the LEVEL slot of a scope value, as
 * `category:<id>`, so every dependent control (Subject, visibility) keeps one
 * key to read. `wholeCategoryOf` recovers the Category; a real Level id never
 * carries the prefix.
 */
const WHOLE_CATEGORY_PREFIX = 'category:';
export function wholeCategoryValue(categoryId: string): string {
  return `${WHOLE_CATEGORY_PREFIX}${categoryId}`;
}
export function wholeCategoryOf(levelId: string): string | null {
  return levelId.startsWith(WHOLE_CATEGORY_PREFIX) ? levelId.slice(WHOLE_CATEGORY_PREFIX.length) : null;
}

export function defaultVisibilityForLevel(
  levels: readonly Level[],
  levelId: string,
): 'public' | 'private' | 'hidden' | null {
  if (levelId === '') return null;
  // A whole Category defaults as any of its Levels does (§15.1: the default
  // is the Category's; the Level is only how it is reached).
  const wholeOf = wholeCategoryOf(levelId);
  const level = levels.find((row) => (wholeOf === null ? row.id === levelId : row.category_id === wholeOf));
  // Absent is not `public`. A screen that guessed the open tier while the list
  // was still arriving would preselect it, and a distracted person would ship
  // content publicly because a request was slow.
  return level?.default_visibility ?? null;
}

/**
 * **R123 — the Category's self-attendance rule, read through the Level.**
 *
 * Same reasoning as `defaultVisibilityForLevel` above, and the same shape:
 * `/admin/categories` is Admin-only (TD-2 R26/R30) and a مؤطِّرة scheduling a
 * class never loads it, so resolving through a Category list would answer
 * `null` on the screen that needs this.
 *
 * **Absent is `null`, never `true`.** A form that guessed *allowed* while the
 * list was arriving would offer self check-in for a children's class, which is
 * exactly the control the Owner said must never appear.
 */
export function selfAttendanceAllowedForLevel(
  levels: readonly Level[],
  levelId: string,
): boolean | null {
  if (levelId === '') return null;
  return levels.find((row) => row.id === levelId)?.self_attendance_allowed ?? null;
}

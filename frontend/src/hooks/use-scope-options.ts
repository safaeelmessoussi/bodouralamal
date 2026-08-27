import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Branch } from '../adapters/branches-admin.js';
import { listAdministrativeGroups, type AdministrativeGroup } from '../adapters/administrative-groups.js';
import type { AcademicYearRef } from '../adapters/reference-data.js';
import type { Category, Level } from '../adapters/taxonomy.js';
import { fetchScopeOptions } from '../adapters/scope-options.js';
import type { SubjectRef } from '../adapters/reference-data.js';
import { levelLabel } from '../components/scope/level-select.js';

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
  /** §4.9's default content visibility for the chosen Level, through its
   *  Category (§15.1). `null` when no Level is chosen or the lists have not
   *  arrived — never guessed, and never `public` on absence. */
  defaultVisibility: 'public' | 'private' | 'hidden' | null;
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
}

/**
 * A **content** key for a field list, so two arrays holding the same fields are
 * the same dependency however they were constructed.
 *
 * Sorted, because `['a','b']` and `['b','a']` request the same data and must not
 * re-fetch; exported so the property can be tested directly rather than
 * inferred from a render count.
 */
export function scopeFieldKey(fields: readonly ScopeField[]): string {
  return [...fields].sort().join(',');
}

export function useScopeOptions({
  token,
  fields,
  initial,
  defaultCurrentYear = false,
  mode = 'form',
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [years, setYears] = useState<AcademicYearRef[]>([]);
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  /** NEW D — every Subject, and each Level's own Subjects, from the one read.
   *  The narrowing below is a lookup rather than a second (Admin-only) request. */
  const [allSubjects, setAllSubjects] = useState<SubjectRef[]>([]);
  const [levelSubjects, setLevelSubjects] = useState<Map<string, string[]>>(new Map());

  const [ready, setReady] = useState(false);
  /**
   * **Always false now, and kept rather than removed** (NEW D).
   *
   * Subjects are derived from the one scope-options read instead of fetched, so
   * there is no window in which the list is in flight. The flag stays because
   * three real behaviours read it — the control's busy state, the *«this Level
   * teaches nothing»* message, and rule 2's clearing guard — and each of them
   * asks *"is this list trustworthy yet?"*, which is a question the hook should
   * keep answering even when today's answer is always yes.
   */
  const loadingSubjects = false;
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
      const payload = await fetchScopeOptions(token);
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
        display_order: null,
        level_count: 0,
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
        display_order: null,
        group_count: 0,
        subject_count: l.subject_ids.length,
        enrollment_count: 0,
        version: 0,
      }));
      const brs: Branch[] = payload.branches.map((b) => ({ id: b.id, name: b.name }) as Branch);
      const yrs: AcademicYearRef[] = payload.academic_years.map((y) => ({
        id: y.id,
        label: y.label,
        is_current: y.is_current,
      }));
      setLevelSubjects(
        new Map(payload.levels.map((l) => [l.id, l.subject_ids])),
      );
      setAllSubjects(payload.subjects.map((x) => ({ id: x.id, name: x.name }) as SubjectRef));
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
  }, [token, wants, needsLevels, defaultCurrentYear]);

  /**
   * ## Subjects depend on the Level — **when a Level is being chosen**
   *
   * A Subject reaches a Level only through `LevelSubject` (§4.4b, R43), so a
   * **form** must offer only the Subjects the chosen Level teaches: offering
   * others is offering the `SUBJECT_NOT_AT_LEVEL` refusal, which is the defect
   * this whole hook was extracted for.
   *
   * **A filter is a different question, and the dependency does not apply to it**
   * (Owner, 2026-08-17). *"Show me everything about تفسير"* is legitimate with no
   * Level in mind, and `GET /library` has always accepted `level_id` and
   * `subject_id` as **independent optionals** — so the gate was a client-side
   * invention, not a contract. `مكتبة المحتوى` disabled the Subject filter behind
   * *«اختاري المستوى أولًا»* and answered a question nobody had to ask.
   *
   * So with no Level chosen the options are **every live Subject**, and choosing
   * a Level narrows them to that Level's. The caller says which mode it is in;
   * `ScopeSelectors` passes `mode` through for exactly this.
   *
   * **The two reads are different endpoints on purpose**: `listSubjects` is the
   * platform's Subject list and `listLevelSubjects` is one Level's pairing. This
   * picks between them; it does not filter one to fake the other.
   */
  /**
   * **Derived during render, not held in state** (NEW D; made a `useMemo` on
   * 2026-08-27 to close a real race).
   *
   * This used to call `/admin/subjects` or `/admin/levels/{id}/subjects` — both
   * Admin-only, so a مؤطِّرة's Subject control was empty in a filter and refused
   * the moment she chose a Level. The one scope-options read carries every
   * Subject and each Level's own, so the SAME rule now runs against data she is
   * allowed to have.
   *
   * The rule itself is unchanged and is still the Owner's (2026-08-17): with no
   * Level chosen a **filter** offers every Subject and a **form** offers none,
   * and choosing a Level narrows to that Level's.
   *
   * ## Why it is a memo and not an effect
   *
   * As an effect it wrote `subjects` state, and that opened a **one-commit
   * window** that silently dropped a seeded Subject:
   *
   * 1. the form mounts with `initial` — Level *and* Subject already chosen;
   * 2. the scope-options payload lands, so `levelSubjects` fills and `ready`
   *    flips true **in the same commit**;
   * 3. rule 2's clearing effect runs on that commit against `options`, which was
   *    memoised **during that render** from the still-EMPTY `subjects` state —
   *    the effect that would have filled it has not committed yet;
   * 4. the seeded Subject is not in an empty list, so it is cleared.
   *
   * Before NEW D the `loadingSubjects` flag was true across that window and rule
   * 2 skipped the field. NEW D removed the fetch and made the flag a constant
   * `false`, which removed the guard along with the request it was guarding —
   * and the defect it had been hiding became reachable. مكتبة المحتوى's upload
   * dialog lost the Subject its page filter had set, every time.
   *
   * Deriving it during render removes the window rather than re-guarding it:
   * `options` can no longer disagree with `levelSubjects`, because both are
   * computed in the same pass from the same data.
   */
  const subjects = useMemo<SubjectRef[]>(() => {
    if (!wants('subjectId')) return [];
    if (value.levelId === '') return subjectsUnscoped ? allSubjects : [];
    const taught = new Set(levelSubjects.get(value.levelId) ?? []);
    return allSubjects.filter((s) => taught.has(s.id));
  }, [value.levelId, wants, subjectsUnscoped, allSubjects, levelSubjects]);

  /* ── Groups depend on Level AND Branch together (§4.4c) ───────────────── */
  useEffect(() => {
    if (!wants('groupId')) return;
    // Neither alone narrows the set: a group is a roster of people **at a
    // premises**, so asking with one half would offer groups at other branches.
    if (value.levelId === '' || value.branchId === '') {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoadingGroups(true);
    void (async () => {
      try {
        const page = await listAdministrativeGroups(token, 1, {
          level_id: value.levelId,
          branch_id: value.branchId,
        });
        if (!cancelled) setGroups(page.data);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.levelId, value.branchId, token, wants]);

  /* ── The option lists ─────────────────────────────────────────────────── */
  const options = useMemo((): Record<ScopeField, Option[]> => {
    const levelPool =
      value.categoryId === '' ? levels : levels.filter((l) => l.category_id === value.categoryId);

    return {
      categoryId: categories.map((c) => ({ value: c.id, label: c.name })),
      // One label for a Level everywhere (`{Category} — {Level}`): a Level name
      // is not unique across Categories and not numbered uniformly (§4.4b), so
      // the bare name genuinely fails to identify one. Shared with the atomic
      // selector rather than spelled out again here.
      levelId: levelPool.map((l) => ({ value: l.id, label: levelLabel(l) })),
      subjectId: subjects.map((s) => ({ value: s.id, label: s.name })),
      branchId: branches.map((b) => ({ value: b.id, label: b.name })),
      academicYearId: years.map((y) => ({ value: y.id, label: y.label })),
      groupId: groups.map((g) => ({ value: g.id, label: g.name })),
    };
  }, [categories, levels, subjects, branches, years, groups, value.categoryId]);

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

  useEffect(() => {
    if (!ready) return;
    setValue((current) => {
      const next = { ...current };
      let changed = false;
      const drop = (field: ScopeField, blocked: boolean): void => {
        if (blocked) return;
        const chosen = current[field];
        if (chosen === '') return;
        if (!optionsRef.current[field].some((o) => o.value === chosen)) {
          next[field] = '';
          changed = true;
        }
      };
      drop('categoryId', false);
      drop('levelId', false);
      // A child whose list is mid-flight is left alone: it will be re-checked
      // when the request lands, and clearing on the way there would blank a
      // valid choice every time its parent is merely re-selected.
      drop('subjectId', loadingSubjects || value.levelId === '');
      drop('branchId', false);
      drop('academicYearId', false);
      drop('groupId', loadingGroups || value.levelId === '' || value.branchId === '');
      return changed ? next : current;
    });
  }, [options, ready, loadingSubjects, loadingGroups, value.levelId, value.branchId]);

  /**
   * Read inside `set`, which must stay referentially stable — a `useCallback`
   * that depended on the flag would change identity and re-run every effect
   * keyed on it, which is the bug this hook's own docstring records for `fields`.
   */
  const unscopedSubjectsRef = useRef(subjectsUnscoped);
  unscopedSubjectsRef.current = subjectsUnscoped;

  const set = useCallback((field: ScopeField, next: string) => {
    setValue((current) => {
      if (current[field] === next) return current;
      const updated = { ...current, [field]: next };
      // **Rule 1, applied at the source.** Clearing descendants here rather than
      // waiting for the reconciliation above means the screen never renders a
      // moment where the old child still looks chosen under a new parent.
      if (field === 'categoryId') {
        updated.levelId = '';
        updated.subjectId = '';
        updated.groupId = '';
      }
      if (field === 'levelId') {
        /**
         * **Clearing the Level keeps the Subject when Subjects are unscoped**
         * (Owner, 2026-08-17).
         *
         * Moving to *another* Level still clears it — that Level may not teach
         * it, and a stale id is what reaches the server as an impossible pair.
         * But **clearing** the Level in a filter is the reader *widening* their
         * question, not retracting their Subject: they asked for تفسير and then
         * removed the Level constraint, and discarding تفسير would throw away
         * the half they did not touch.
         *
         * In a form (`subjectsUnscoped: false`) it clears either way, because
         * with no Level there is no valid Subject to hold.
         */
        const wideningAFilter = next === '' && unscopedSubjectsRef.current;
        if (!wideningAFilter) updated.subjectId = '';
        updated.groupId = '';
      }
      if (field === 'branchId') {
        updated.groupId = '';
      }
      return updated;
    });
  }, []);

  const setMany = useCallback((patch: Partial<ScopeValue>) => {
    setValue((current) => ({ ...current, ...patch }));
  }, []);

  return {
    value,
    set,
    setMany,
    options,
    loading: {
      categoryId: !ready,
      levelId: !ready,
      subjectId: loadingSubjects,
      branchId: !ready,
      academicYearId: !ready,
      groupId: loadingGroups,
    },
    ready,
    levelTeachesNothing:
      wants('subjectId') && value.levelId !== '' && !loadingSubjects && subjects.length === 0,
    /**
     * §4.9's default content visibility for the currently chosen Level, through
     * its Category (§15.1) — `null` until both lists have arrived.
     *
     * Resolved here rather than on the screen because the Level → Category hop
     * is the same one `categoryDefaultVisibility` makes on the server, and a
     * screen re-deriving it would be a second answer to one question.
     */
    defaultVisibility: defaultVisibilityForLevel(levels, value.levelId),
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
export function defaultVisibilityForLevel(
  levels: readonly Level[],
  levelId: string,
): 'public' | 'private' | 'hidden' | null {
  if (levelId === '') return null;
  const level = levels.find((row) => row.id === levelId);
  // Absent is not `public`. A screen that guessed the open tier while the list
  // was still arriving would preselect it, and a distracted person would ship
  // content publicly because a request was slow.
  return level?.default_visibility ?? null;
}

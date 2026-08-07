import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listBranches, type Branch } from '../adapters/branches-admin.js';
import { listAdministrativeGroups, type AdministrativeGroup } from '../adapters/administrative-groups.js';
import { listAcademicYears, type AcademicYearRef } from '../adapters/reference-data.js';
import { listCategories, listLevelSubjects, listLevels, type Category, type Level } from '../adapters/taxonomy.js';
import type { SubjectRef } from '../adapters/reference-data.js';

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
}: UseScopeOptionsInput): ScopeOptions {
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
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);

  const [ready, setReady] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Levels are needed whenever a Category, Level or Group is offered: a Category
  // narrows Levels, and a Group is reached through one.
  const needsLevels = wants('categoryId') || wants('levelId') || wants('groupId');

  /* ── The independent lists, once ──────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cats, lvls, brs, yrs] = await Promise.all([
        wants('categoryId') ? listCategories(token) : Promise.resolve<Category[]>([]),
        needsLevels ? listLevels(token) : Promise.resolve<Level[]>([]),
        wants('branchId') || wants('groupId')
          ? listBranches(token).then((p) => p.data)
          : Promise.resolve<Branch[]>([]),
        wants('academicYearId')
          ? listAcademicYears(token)
          : Promise.resolve<AcademicYearRef[]>([]),
      ]);
      if (cancelled) return;
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

  /* ── Subjects depend on the Level, and on nothing else ────────────────── */
  useEffect(() => {
    if (!wants('subjectId')) return;
    if (value.levelId === '') {
      setSubjects([]);
      return;
    }
    let cancelled = false;
    setLoadingSubjects(true);
    void (async () => {
      try {
        const taught = await listLevelSubjects(value.levelId, token);
        if (!cancelled) setSubjects(taught);
      } finally {
        if (!cancelled) setLoadingSubjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.levelId, token, wants]);

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
      levelId: levelPool.map((l) => ({ value: l.id, label: l.name })),
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
        updated.subjectId = '';
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
  };
}

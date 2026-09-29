import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Feedback } from '../ui/feedback.js';

import { listAdministrativeGroups } from '../../adapters/administrative-groups.js';
import { listCircles } from '../../adapters/teaching-groups.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import { t } from '../../i18n/index.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { fetchAllPages } from './session-audience-dialog.js';

/**
 * **Who a class is for, as five filters — and never a «نمط التدريس»** (SRS
 * Revision 163 §5, confirming Revision 160 §2).
 *
 * Every filter reads «الكل» until somebody narrows it, and one or more values
 * may be chosen in each. Branches, Categories, Levels and Administrative Groups
 * INTERSECT (one enrolment must satisfy all of them); a Teaching Circle is
 * added on top, because it is already a fixed, Level-locked roster
 * (`audienceWhere`, `roster-resolution.ts`). That rule is the server's and is
 * unchanged — this module only stops asking the administrator to pick a
 * storage mode before she may say who the class is for.
 *
 * One module, used by «إضافة عنصر» and by the «from this date onward» editor,
 * so the two cannot offer different filters or narrow them differently.
 */
export interface AudienceSelection {
  branchIds: readonly string[];
  categoryIds: readonly string[];
  levelIds: readonly string[];
  groupIds: readonly string[];
  teachingGroupIds: readonly string[];
}

export interface AudienceSetters {
  setBranchIds: (next: string[]) => void;
  setCategoryIds: (next: string[]) => void;
  setLevelIds: (next: string[]) => void;
  setGroupIds: (next: string[]) => void;
  setTeachingGroupIds: (next: string[]) => void;
}

/** A group is a roster at a premises (§4.4c); a circle is a Subject's split at
 *  a Level and, since R172 §15, records the branch it was created in — `null`
 *  on one from before the column, which then answers no branch filter (the
 *  same rule «حلقات المواد» applies). */
interface Roster {
  id: string;
  name: string;
  levelId: string;
  branchId: string | null;
  /** Circles only — what tells two «1»s apart (R179 §4). */
  subjectName?: string;
  branchName?: string | null;
}

export interface AudienceChoices {
  levels: { id: string; name: string }[];
  /**
   * `name` is the roster's own («1»), which the composed title reads; `label`
   * is what the picker shows — a group as «1 — كتاكيت الأمل — مقر تاركة»
   * (name, Level, branch; R179 §5), a circle as its name, its Subject and its
   * branch (R179 §4) — the branch in both once the rosters on offer span
   * more than one (the rooms' rule, R165 §6).
   */
  groups: { id: string; name: string; label: string }[];
  circles: { id: string; name: string; label: string }[];
  /**
   * SRS Revision 165 §2 — **the Levels the selection actually addresses**: the
   * ones chosen, plus the Level of every chosen group and circle (the server's
   * `effectiveLevelIds`, mirrored). The Surahs a by-Surah class may name are
   * drawn from these Levels' «مقرر الحفظ».
   */
  levelIdsInPlay: string[];
}

/**
 * Loads every group and circle, narrows each filter from the ones above it,
 * drops a choice its parent no longer offers, and keeps the scope hook's single
 * `branchId`/`levelId` in step — the class's own branch, and a representative
 * Level that does nothing but drive the Subject list.
 *
 * `active` is false wherever the filters are not on screen (another item type,
 * a locked row, a self-service مؤطِّرة): nothing is requested and nothing moves.
 */
export function useAudienceFilters({
  active,
  token,
  scope,
  selection,
  setters,
}: {
  active: boolean;
  token: string | null;
  scope: ScopeOptions;
  selection: AudienceSelection;
  setters: Pick<AudienceSetters, 'setLevelIds' | 'setGroupIds' | 'setTeachingGroupIds'>;
}): AudienceChoices {
  const { branchIds, categoryIds, levelIds, groupIds, teachingGroupIds } = selection;
  const { setLevelIds, setGroupIds, setTeachingGroupIds } = setters;
  const [allGroups, setAllGroups] = useState<Roster[]>([]);
  const [allCircles, setAllCircles] = useState<Roster[]>([]);

  useEffect(() => {
    if (!active || token === null) return;
    // Every page, not the first hundred: a filter silently missing a group is a
    // class that cannot be addressed to it (`fetchAllPages`).
    void fetchAllPages((page) => listAdministrativeGroups(token, page, {}, null, 100))
      .then((rows) =>
        setAllGroups(
          rows.map((g) => ({ id: g.id, name: g.name, levelId: g.level_id, branchId: g.branch_id })),
        ),
      )
      .catch(() => setAllGroups([]));
    // R179 §4 (Owner-reported, 2026-09-29) — the circle's OWN branch, which
    // this read as `null` since before R172 §15 gave circles one: every branch's
    // circles were offered under «مقر أمرشيش», and as bare «1», «1».
    void fetchAllPages((page) => listCircles(token, page, {}, null, 100))
      .then((rows) =>
        setAllCircles(
          rows.map((c) => ({
            id: c.id,
            name: c.name,
            levelId: c.level_id,
            branchId: c.branch_id ?? null,
            subjectName: c.subject_name,
            branchName: c.branch_name,
          })),
        ),
      )
      .catch(() => setAllCircles([]));
  }, [active, token]);

  /**
   * **Each filter narrows the ones beneath it** — a Category leaves only its own
   * Levels on offer, and the Levels and branches in play leave only their own
   * groups and circles. That is what makes an intersecting picker usable: it
   * stops offering combinations that can match nobody. Parent to child only;
   * nothing here is authorization, and the server resolves the audience
   * whatever was offered.
   */
  const levelChoices = useMemo(
    () =>
      scope.options.levelId.filter(
        (o) =>
          categoryIds.length === 0 || categoryIds.includes(scope.levelCategoryIds[o.value] ?? ''),
      ),
    [scope.options.levelId, scope.levelCategoryIds, categoryIds],
  );
  const levelsInPlay = useMemo(
    () =>
      levelIds.length > 0
        ? new Set(levelIds)
        : categoryIds.length > 0
          ? new Set(levelChoices.map((o) => o.value))
          : null,
    [levelIds, categoryIds, levelChoices],
  );
  const withinFilters = useCallback(
    (row: Roster) =>
      (levelsInPlay === null || levelsInPlay.has(row.levelId)) &&
      (branchIds.length === 0 || (row.branchId !== null && branchIds.includes(row.branchId))),
    [levelsInPlay, branchIds],
  );
  const groupChoices = useMemo(() => allGroups.filter(withinFilters), [allGroups, withinFilters]);
  const circleChoices = useMemo(() => allCircles.filter(withinFilters), [allCircles, withinFilters]);
  // Named with the branch only once the rosters on offer span more than one —
  // the rule the rooms already follow (R165 §6). A circle always names its
  // Subject (a Level's «1» of أحكام التجويد and its «1» of حفظ القرآن are
  // different rosters); a group its Level (R179 §5 — «1 — كتاكيت الأمل — مقر
  // تاركة»). The branch is read from the scope hook's own list for a group,
  // which carries only its id on the wire.
  const branchNames = useMemo(
    () => Object.fromEntries(scope.options.branchId.map((o) => [o.value, o.label])),
    [scope.options.branchId],
  );
  const labelled = (
    rows: Roster[],
    middle: (row: Roster) => string | undefined,
    branchOf: (row: Roster) => string | null | undefined,
  ) => {
    const spansBranches = new Set(rows.map((r) => r.branchId ?? '')).size > 1;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      label: [r.name, middle(r), spansBranches ? branchOf(r) : null]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' — '),
    }));
  };
  const groupLabels = useMemo(
    () =>
      labelled(
        groupChoices,
        (g) => scope.levelNames[g.levelId],
        (g) => (g.branchId === null ? null : branchNames[g.branchId]),
      ),
    [groupChoices, scope.levelNames, branchNames],
  );
  const circleLabels = useMemo(
    () => labelled(circleChoices, (c) => c.subjectName, (c) => c.branchName),
    [circleChoices],
  );

  // A choice its parent no longer offers is dropped rather than submitted
  // unseen — the picker would otherwise send a group the reader cannot see.
  //
  // **R179 §8 (Owner-reported, 2026-09-29) — never against a list that has
  // not arrived.** This ran on mount, before `/me/scope-options` answered,
  // against an EMPTY Level list — so a class opened for edit lost the Level
  // it was seeded with (R176 §2): the form read «مستويات: الكل», was dirty
  // before anybody touched it (the close-without-saving prompt on an untouched
  // form), and a save re-sent `dimensions` without the Level, widening the
  // class to its whole Category. `scope.ready` is the same guard the scope
  // hook's own rule 2 uses; the two rosters below already wait for theirs.
  useEffect(() => {
    if (!active || !scope.ready) return;
    const offered = new Set(levelChoices.map((o) => o.value));
    if (levelIds.some((id) => !offered.has(id))) setLevelIds(levelIds.filter((id) => offered.has(id)));
  }, [active, scope.ready, levelChoices, levelIds, setLevelIds]);
  useEffect(() => {
    if (!active || allGroups.length === 0) return;
    const offered = new Set(groupChoices.map((g) => g.id));
    if (groupIds.some((id) => !offered.has(id))) setGroupIds(groupIds.filter((id) => offered.has(id)));
  }, [active, allGroups.length, groupChoices, groupIds, setGroupIds]);
  useEffect(() => {
    if (!active || allCircles.length === 0) return;
    const offered = new Set(circleChoices.map((c) => c.id));
    if (teachingGroupIds.some((id) => !offered.has(id))) {
      setTeachingGroupIds(teachingGroupIds.filter((id) => offered.has(id)));
    }
  }, [active, allCircles.length, circleChoices, teachingGroupIds, setTeachingGroupIds]);

  const setScope = scope.set;

  /**
   * **A representative Level, purely to drive the Subject list.** Several
   * Levels may be in play; the server validates the Subject against every
   * effective one on save (`assertSubjectTaughtAtLevel`, looped). This is a form
   * convenience, never the authority on which Levels are correct.
   */
  const representativeLevelId =
    levelIds[0] ??
    allGroups.find((g) => groupIds.includes(g.id))?.levelId ??
    allCircles.find((c) => teachingGroupIds.includes(c.id))?.levelId ??
    '';
  const scopeLevelId = scope.value.levelId;
  // A group or circle is chosen but its roster list has not arrived yet: its
  // Level is unknown, not absent. Pushing `''` in that instant would clear a
  // Subject the editor opened with (the scope hook drops a Subject whose Level
  // went away), so nothing moves until the answer is real.
  const awaitingRosters =
    (groupIds.length > 0 && allGroups.length === 0) ||
    (teachingGroupIds.length > 0 && allCircles.length === 0);
  useEffect(() => {
    if (!active || awaitingRosters) return;
    if (representativeLevelId !== scopeLevelId) setScope('levelId', representativeLevelId);
  }, [active, awaitingRosters, representativeLevelId, scopeLevelId, setScope]);

  const levelIdsInPlay = useMemo(
    () => [
      ...new Set([
        ...levelIds,
        ...allGroups.filter((g) => groupIds.includes(g.id)).map((g) => g.levelId),
        ...allCircles.filter((c) => teachingGroupIds.includes(c.id)).map((c) => c.levelId),
      ]),
    ],
    [levelIds, groupIds, teachingGroupIds, allGroups, allCircles],
  );

  return {
    levels: levelChoices.map((o) => ({ id: o.value, name: o.label })),
    groups: groupLabels,
    circles: circleLabels,
    levelIdsInPlay,
  };
}

/**
 * **The class's own branch, DERIVED — never a second «فروع» question** (Owner,
 * 2026-09-20 — SRS Revision 165 §6).
 *
 * A class still belongs to one branch (`branch_id`: whose administration runs
 * it, and where its room is booked — §4.4), but asking for it beside the «فروع»
 * filter read as the same question twice. It follows from what she already
 * said, in this order: the ONE branch she chose; else the branch of the room she
 * chose; else the branch the class already belongs to, while her choice still
 * includes it; else the first branch she chose; else the first she may act on.
 */
export function homeBranchOf(
  selection: Pick<AudienceSelection, 'branchIds'>,
  context: { roomBranchId?: string | null; currentBranchId?: string | null; permitted: readonly string[] },
): string {
  const chosen = selection.branchIds;
  if (chosen.length === 1) return chosen[0]!;
  const within = (id: string | null | undefined): id is string =>
    typeof id === 'string' && id !== '' && (chosen.length === 0 || chosen.includes(id));
  if (within(context.roomBranchId)) return context.roomBranchId;
  if (within(context.currentBranchId)) return context.currentBranchId;
  return chosen[0] ?? context.permitted[0] ?? '';
}

/** The payload half: a filter left at «الكل» is ABSENT, never an empty array
 *  the server would have to interpret. */
export function audienceDimensions(selection: AudienceSelection): {
  branchIds?: string[];
  categoryIds?: string[];
  levelIds?: string[];
  administrativeGroupIds?: string[];
  teachingGroupIds?: string[];
} {
  return {
    ...(selection.branchIds.length > 0 ? { branchIds: [...selection.branchIds] } : {}),
    ...(selection.categoryIds.length > 0 ? { categoryIds: [...selection.categoryIds] } : {}),
    ...(selection.levelIds.length > 0 ? { levelIds: [...selection.levelIds] } : {}),
    ...(selection.groupIds.length > 0 ? { administrativeGroupIds: [...selection.groupIds] } : {}),
    ...(selection.teachingGroupIds.length > 0
      ? { teachingGroupIds: [...selection.teachingGroupIds] }
      : {}),
  };
}

/**
 * Whether the selection names a Level, a group or a circle.
 *
 * **No longer a requirement for a class** (SRS Revision 169 §7): with none
 * named, the class reaches every Level that teaches its Subject, and the filters
 * say so. It still IS one for a single occurrence's audience override
 * (`schedule-sessions.tsx`), where «everybody» has no Subject-wide meaning to
 * fall back on.
 */
export function namesATeachingPopulation(selection: AudienceSelection): boolean {
  return (
    selection.levelIds.length > 0 ||
    selection.groupIds.length > 0 ||
    selection.teachingGroupIds.length > 0
  );
}

export function AudienceFilters({
  scope,
  selection,
  setters,
  choices,
}: {
  scope: ScopeOptions;
  selection: AudienceSelection;
  setters: AudienceSetters;
  choices: AudienceChoices;
}): ReactNode {
  const asOptions = (rows: { id: string; name: string }[]) =>
    rows.map((o) => ({ value: o.id, label: o.name }));
  return (
    <>
      <MultiSelectField
        label={t('admin.calendar.scopeBranch')}
        selected={selection.branchIds}
        onChange={setters.setBranchIds}
        options={scope.options.branchId}
        emptyLabel={t('common.all')}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeCategory')}
        selected={selection.categoryIds}
        onChange={setters.setCategoryIds}
        options={scope.options.categoryId}
        emptyLabel={t('common.all')}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeLevel')}
        selected={selection.levelIds}
        onChange={setters.setLevelIds}
        options={asOptions(choices.levels)}
        emptyLabel={t('common.all')}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeGroup')}
        selected={selection.groupIds}
        onChange={setters.setGroupIds}
        options={choices.groups.map((g) => ({ value: g.id, label: g.label }))}
        emptyLabel={t('common.all')}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeCircle')}
        selected={selection.teachingGroupIds}
        onChange={setters.setTeachingGroupIds}
        options={choices.circles.map((c) => ({ value: c.id, label: c.label }))}
        emptyLabel={t('common.all')}
      />
      {/* R169 §7 — «الكل» on Level, group AND circle is a real answer now, and
          what it MEANS is said where it is chosen: every Level that teaches the
          Subject, fixed when the class is saved and visible on «تعديل». */}
      {namesATeachingPopulation(selection) ? null : (
        <Feedback>{t('admin.calendar.scopeEveryLevelHint')}</Feedback>
      )}
    </>
  );
}

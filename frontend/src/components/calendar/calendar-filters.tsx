import type { ReactNode } from 'react';

import type { CategoryRef, LevelRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { SelectField } from '../ui/field.js';
import { BranchSelector } from '../ui/branch-selector.js';
import { CategorySelector } from './category-selector.js';
import { LevelSelector } from './level-selector.js';
import type { CalendarFilterField, CalendarFilters as Filters } from '../../hooks/use-calendar-filters.js';

/**
 * **The calendar's filter row, for every surface that has one.**
 *
 * It renders the fields the surface asks for, in dependency order — branch, then
 * category, then the level the category narrows — reading and writing the ONE
 * state object both of that surface's views share (`useCalendarFilters`). That
 * sharing is the whole fix: قائمة and تقويم cannot disagree about what is being
 * filtered when there is only one answer.
 *
 * **The caller decides which fields exist, and that is a permission decision**
 * (rule O): a beneficiary reading her own calendar is not offered a branch
 * filter, because her calendar is hers and the control would imply a scope she
 * does not have. This component renders what it is handed and decides nothing.
 *
 * It replaces `CalendarToolbar`, which rendered a fixed three — branch, category,
 * level — and so could not serve a surface that needed a subject or a type, nor
 * one that must not offer a branch.
 */
export function CalendarFilters({
  filters,
  branches,
  categories,
  levels,
  subjects,
  groups,
  circles,
  types,
  levelsBusy = false,
}: {
  filters: Filters;
  /**
   * `{ id, name }` rather than the full `PublicBranch`: this row needs a label
   * and an id, and asking for the public record would stop the back office
   * passing the branches `useScopeOptions` has already loaded and scoped to the
   * caller — which would mean fetching the same list twice per page.
   */
  branches?: { id: string; name: string }[];
  categories?: CategoryRef[];
  levels?: LevelRef[];
  subjects?: { id: string; name: string }[];
  groups?: { id: string; name: string }[];
  circles?: { id: string; name: string }[];
  /** The event/session kinds this surface distinguishes, already labelled. */
  types?: { value: string; label: string }[];
  levelsBusy?: boolean;
}): ReactNode {
  const has = (field: CalendarFilterField): boolean => filters.fields.includes(field);
  const value = (field: CalendarFilterField): string | null => filters.value[field] ?? null;

  return (
    <>
      {has('branchId') ? (
        <BranchSelector
          // `BranchSelector` reads only `id` and `name`; the rest of
          // `PublicBranch` is the landing page's directory data.
          branches={(branches ?? []) as Parameters<typeof BranchSelector>[0]['branches']}
          value={value('branchId')}
          onChange={(id) => filters.set('branchId', id)}
        />
      ) : null}

      {has('categoryId') ? (
        <CategorySelector
          categories={categories ?? []}
          value={value('categoryId')}
          onChange={(id) => filters.set('categoryId', id)}
        />
      ) : null}

      {has('levelId') ? (
        // The Categories travel through purely to complete the Level label —
        // `{Category} — {Level}`, the platform's one format (rule D).
        <LevelSelector
          levels={levels ?? []}
          categories={categories ?? []}
          value={value('levelId')}
          busy={levelsBusy}
          onChange={(id) => filters.set('levelId', id)}
        />
      ) : null}

      {has('subjectId') ? (
        <SelectField
          label={t('calendar.filters.subject')}
          value={value('subjectId') ?? ''}
          onChange={(v) => filters.set('subjectId', v || null)}
          options={[
            { value: '', label: t('calendar.filters.all') },
            ...(subjects ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      ) : null}

      {has('groupId') ? (
        <SelectField
          label={t('calendar.filters.group')}
          value={value('groupId') ?? ''}
          onChange={(v) => filters.set('groupId', v || null)}
          options={[
            { value: '', label: t('calendar.filters.all') },
            ...(groups ?? []).map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
      ) : null}

      {has('circleId') ? (
        <SelectField
          label={t('calendar.filters.circle')}
          value={value('circleId') ?? ''}
          onChange={(v) => filters.set('circleId', v || null)}
          options={[
            { value: '', label: t('calendar.filters.all') },
            ...(circles ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      ) : null}

      {has('type') ? (
        <SelectField
          label={t('calendar.filters.type')}
          value={value('type') ?? ''}
          onChange={(v) => filters.set('type', v || null)}
          options={[{ value: '', label: t('calendar.filters.all') }, ...(types ?? [])]}
        />
      ) : null}
    </>
  );
}

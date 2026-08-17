import type { ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import type { CategoryRef, LevelRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { BranchSelector } from '../ui/branch-selector.js';
import { CategorySelector } from './category-selector.js';
import { LevelSelector } from './level-selector.js';

/**
 * The filter row.
 *
 * Month navigation used to share this bar; it is now its own centred block above
 * (`CalendarNav`), which separates *where you are looking* from *what you are
 * looking at* — two different questions that were competing for one row.
 *
 * It composes the selectors and owns nothing itself, so any of them can be reused
 * on another surface — a week view, a dashboard — without dragging this layout
 * along.
 *
 * Filter order follows dependency: branch, then category, then the level the
 * category narrows. Reading right to left in RTL, that is the order the choices
 * are actually made in.
 */
export function CalendarToolbar({
  branches,
  branchId,
  onBranchChange,
  categories,
  categoryId,
  onCategoryChange,
  levels,
  levelId,
  levelsBusy,
  onLevelChange,
}: {
  branches: PublicBranch[];
  branchId: string | null;
  onBranchChange: (id: string | null) => void;
  categories: CategoryRef[];
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
  levels: LevelRef[];
  levelId: string | null;
  levelsBusy: boolean;
  onLevelChange: (id: string | null) => void;
}): ReactNode {
  return (
    <div className="cal-toolbar" role="group" aria-label={t('calendar.filtersLabel')}>
      <BranchSelector branches={branches} value={branchId} onChange={onBranchChange} />
      <CategorySelector categories={categories} value={categoryId} onChange={onCategoryChange} />
      {/* The Categories are passed through purely to complete the Level label —
          `{Category} — {Level}`, the platform's one format. They come from the
          same bootstrap payload as `levels`; see `LevelSelector`. */}
      <LevelSelector
        levels={levels}
        categories={categories}
        value={levelId}
        busy={levelsBusy}
        onChange={onLevelChange}
      />
    </div>
  );
}

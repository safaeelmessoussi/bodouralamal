import type { ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import type { CategoryRef, LevelRef } from '../../adapters/calendar.js';
import { BranchSelector } from './branch-selector.js';
import { CategorySelector } from './category-selector.js';
import { LevelSelector } from './level-selector.js';
import { MonthSelector } from './month-selector.js';

/**
 * The control bar: month navigation on one side, the filter row on the other.
 *
 * It composes the selectors and owns nothing itself, so any of them can be
 * reused on another surface — a week view, a dashboard — without dragging this
 * layout along.
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
  month,
  onPrevious,
  onNext,
  onToday,
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
  month: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}): ReactNode {
  return (
    <div className="cal-toolbar">
      <MonthSelector month={month} onPrevious={onPrevious} onNext={onNext} onToday={onToday} />
      <div className="cal-toolbar__filters">
        <BranchSelector branches={branches} value={branchId} onChange={onBranchChange} />
        <CategorySelector categories={categories} value={categoryId} onChange={onCategoryChange} />
        <LevelSelector
          levels={levels}
          value={levelId}
          busy={levelsBusy}
          onChange={onLevelChange}
        />
      </div>
    </div>
  );
}

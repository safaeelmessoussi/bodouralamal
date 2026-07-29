import type { ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import { BranchSelector } from './branch-selector.js';
import { MonthSelector } from './month-selector.js';

/**
 * The top control bar: branch filter on one side, month navigation on the
 * other. It composes the two selectors and owns nothing itself, so either can
 * be reused on another surface (a week view, a dashboard) without dragging the
 * bar's layout along.
 */
export function CalendarToolbar({
  branches,
  branchId,
  onBranchChange,
  month,
  onPrevious,
  onNext,
  onToday,
}: {
  branches: PublicBranch[];
  branchId: string | null;
  onBranchChange: (id: string | null) => void;
  month: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}): ReactNode {
  return (
    <div className="cal-toolbar">
      <BranchSelector branches={branches} value={branchId} onChange={onBranchChange} />
      <MonthSelector month={month} onPrevious={onPrevious} onNext={onNext} onToday={onToday} />
    </div>
  );
}

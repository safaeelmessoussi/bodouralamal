import type { ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import { t } from '../../i18n/index.js';

/**
 * Branch filter.
 *
 * A native `<select>`: it is one choice from a short list, and the platform
 * control is keyboard-accessible, screen-reader-correct and familiar on the
 * low-end phones §2.2 targets — a custom listbox would have to re-earn all
 * three. The options come from the branches adapter, never from a literal here.
 */
export function BranchSelector({
  branches,
  value,
  onChange,
}: {
  branches: PublicBranch[];
  value: string | null;
  onChange: (branchId: string | null) => void;
}): ReactNode {
  return (
    <div className="branch-selector">
      <label className="branch-selector__label" htmlFor="branch-filter">
        {t('calendar.branchLabel')}
      </label>
      <select
        id="branch-filter"
        className="branch-selector__control"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('calendar.allBranches')}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </div>
  );
}

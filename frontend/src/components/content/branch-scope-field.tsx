import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { MultiSelectField } from '../ui/multi-select.js';

/**
 * **R223 — «الفرع» is one dropdown, «الكل» by default** (the Owner,
 * 2026-10-16; R217's «كل الفروع» tick withdrawn). For an administrator nothing
 * chosen reads «الكل» — the Global scope (§4.9, `branch_ids: []`), one item
 * under «كل الفروع» in the library — and choosing every branch is read as
 * «الكل» too. A مؤطِّرة names at least one: Global is not hers to assign.
 */
export function BranchScopeField({
  branches,
  selected,
  onChange,
  mayAssignGlobal,
  disabled = false,
  error = null,
}: {
  branches: readonly { value: string; label: string }[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  mayAssignGlobal: boolean;
  disabled?: boolean;
  error?: string | null;
}): ReactNode {
  return (
    <MultiSelectField
      label={t('scope.branch')}
      options={branches}
      selected={selected}
      onChange={(ids) =>
        onChange(mayAssignGlobal && branches.length > 1 && ids.length === branches.length ? [] : ids)
      }
      {...(mayAssignGlobal ? { emptyLabel: t('content.allBranches') } : { required: true })}
      disabled={disabled}
      error={error}
    />
  );
}

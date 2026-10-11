import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { CheckboxField } from '../ui/field.js';
import { MultiSelectField } from '../ui/multi-select.js';

/**
 * **R217 — «كل الفروع» said in words** (the Owner, 2026-10-11: choosing every
 * branch one by one listed the item once under each branch, where she meant
 * it for all of them). An administrator ticks «كل الفروع» — the Global scope
 * (§4.9, `branch_ids: []`), one item under «كل الفروع» in the library — or
 * names branches; naming every one of them is read as «كل الفروع» too. A
 * مؤطِّرة names at least one: Global is not hers to assign.
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
  const everywhere = mayAssignGlobal && selected.length === 0;
  return (
    <>
      {mayAssignGlobal ? (
        <CheckboxField
          label={t('content.upload.allBranches')}
          checked={everywhere}
          disabled={disabled}
          onChange={(checked) => onChange(checked ? [] : branches.slice(0, 1).map((b) => b.value))}
        />
      ) : null}
      {everywhere ? null : (
        <MultiSelectField
          label={t('scope.branch')}
          options={branches}
          selected={selected}
          onChange={(ids) =>
            onChange(mayAssignGlobal && branches.length > 1 && ids.length === branches.length ? [] : ids)
          }
          disabled={disabled}
          required
          error={error}
        />
      )}
    </>
  );
}

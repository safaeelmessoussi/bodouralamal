import type { ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import { t } from '../../i18n/index.js';
import { SelectField } from './field.js';

/**
 * `BranchSelector` — §14.3's registry entry, built once for every screen that
 * asks "which branch?".
 *
 * **Promoted out of `components/calendar/` in Revision 39**, where it had been
 * a calendar widget with three problems the registry exists to prevent:
 *
 * 1. **A hardcoded `id="branch-filter"`** — two on one page would have produced
 *    duplicate ids and a label pointing at the wrong control. That is the exact
 *    defect the shared `Dialog` shipped with, and the reason the field
 *    primitives generate ids with `useId`.
 * 2. **Its own markup and its own `.branch-selector` styles**, so it could not
 *    inherit error wiring, required marking or hint association from `field.tsx`.
 * 3. **An always-present "all branches" option**, which is right for a filter
 *    and wrong for a required choice — registration must not offer "all".
 *
 * It is now a thin configuration of `SelectField`, so accessibility comes from
 * the primitive rather than from this file remembering it.
 *
 * **Two modes, one component** (§2.5 — variants, not new components):
 *
 * | `allowAll` | Empty option means | Used by |
 * |---|---|---|
 * | `true` (default) | *no filter applied* | Calendar, Approvals queue |
 * | `false` | *nothing chosen yet* — with `required`, the form refuses to submit | Registration |
 *
 * Options always come from the branches adapter and **never from a literal
 * here**, so a branch added in the back office appears with no frontend change
 * (§4.1, Revision 39 — the selector reads the public `GET /branches`, not a
 * registration-metadata endpoint that would duplicate reference data).
 */
export function BranchSelector({
  branches,
  value,
  onChange,
  label,
  allowAll = true,
  emptyLabel,
  required = false,
  error = null,
  hint = null,
  disabled = false,
}: {
  branches: PublicBranch[];
  value: string | null;
  onChange: (branchId: string | null) => void;
  label?: string;
  /** `true` for a filter, `false` for a choice the caller requires. */
  allowAll?: boolean;
  /** Text of the empty option — "all branches" filtering, "choose one" picking. */
  emptyLabel?: string;
  required?: boolean;
  error?: string | null;
  hint?: string | null;
  disabled?: boolean;
}): ReactNode {
  return (
    <SelectField
      label={label ?? t('calendar.branchLabel')}
      value={value ?? ''}
      onChange={(next) => onChange(next === '' ? null : next)}
      placeholder={emptyLabel ?? (allowAll ? t('calendar.allBranches') : t('common.choose'))}
      options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
      required={required}
      error={error}
      hint={hint}
      disabled={disabled}
    />
  );
}

import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
import { t } from '../../i18n/index.js';
import type { Option, ScopeField, ScopeOptions } from '../../hooks/use-scope-options.js';

/**
 * The curriculum selectors, rendered the same way everywhere.
 *
 * `useScopeOptions` owns *which values are valid*; this owns *how they look and
 * what they say when there are none*. Splitting it that way is what lets a
 * filter bar and an edit form share the identical dependency rules while looking
 * like the surfaces they belong to.
 *
 * **An empty list is never a bare empty dropdown.** Three states are genuinely
 * different and are worded differently:
 *
 * | State | What it says |
 * |---|---|
 * | Parent not chosen | *choose a level first* — an instruction, not a failure |
 * | Parent chosen, list loading | the field is `busy`; the previous label stays |
 * | Parent chosen, list genuinely empty | *this level teaches no subjects* — a true statement about the curriculum, naming the screen that changes it |
 *
 * The third is the one that mattered: it is the state that used to reach the
 * server as `SUBJECT_NOT_AT_LEVEL`, and presenting it as an empty dropdown would
 * leave an administrator guessing whether the platform was broken.
 */

/** The dependency each field has, so the placeholder can name what is missing.
 *  Read from the graph rather than hardcoded per call site. */
const REQUIRES: Partial<Record<ScopeField, { field: ScopeField; labelKey: string }[]>> = {
  levelId: [],
  subjectId: [{ field: 'levelId', labelKey: 'scope.level' }],
  groupId: [
    { field: 'levelId', labelKey: 'scope.level' },
    { field: 'branchId', labelKey: 'scope.branch' },
  ],
};

const LABEL_KEY: Record<ScopeField, string> = {
  categoryId: 'scope.category',
  levelId: 'scope.level',
  subjectId: 'scope.subject',
  branchId: 'scope.branch',
  academicYearId: 'scope.academicYear',
  groupId: 'scope.group',
};

export interface ScopeSelectorsProps {
  scope: ScopeOptions;
  /** Which fields to render, in this order. */
  fields: readonly ScopeField[];
  /**
   * `filter` adds an "all …" choice and lets a field be cleared; `form`
   * requires a value. The same component either way — a filter bar and a form
   * differ in whether *unset* is meaningful, not in how a selector looks.
   */
  mode: 'filter' | 'form';
  /** Fields the caller wants disabled regardless (an edit form pinning a Level). */
  locked?: readonly ScopeField[];
  /**
   * Domain values a field can take that are not rows in its table.
   *
   * The platform has exactly one: **Global / بدون فرع** is `branch_id = null`
   * (§4.9), a real and authorization-relevant scope that no branch list can
   * contain. It belongs to the screens that mean it — content — rather than to
   * this component, which would otherwise have to know why a branch selector
   * sometimes offers a non-branch.
   */
  extraOptions?: Partial<Record<ScopeField, Option[]>>;
}

export function ScopeSelectors({
  scope,
  fields,
  mode,
  locked = [],
  extraOptions = {},
}: ScopeSelectorsProps): ReactNode {
  return (
    <>
      {fields.map((field) => {
        /**
         * **A filter's Subject has no unmet dependency** (Owner, 2026-08-17).
         *
         * The `subjectId → levelId` edge exists so a FORM cannot offer a pair the
         * server refuses (`SUBJECT_NOT_AT_LEVEL`). A filter asks a different
         * question — *"everything about تفسير"* is legitimate with no Level in
         * mind — and `GET /library` has always taken the two as independent
         * optionals, so the gate was a client-side invention.
         *
         * The edge stays in `REQUIRES` because it is true of forms, which is
         * where it does its work; what changes is that a filter does not read it
         * for this one field. `useScopeOptions({ subjectsUnscoped: true })` is
         * what fills the control in that case.
         */
        const ignoreDependency = mode === 'filter' && field === 'subjectId';
        const unmetDependency = ignoreDependency
          ? undefined
          : (REQUIRES[field] ?? []).find((dep) => scope.value[dep.field] === '');
        const list = [...(extraOptions[field] ?? []), ...scope.options[field]];
        const isEmpty = !unmetDependency && !scope.loading[field] && list.length === 0;

        const placeholder = unmetDependency
          ? t('scope.chooseFirst').replace('{field}', t(unmetDependency.labelKey))
          : isEmpty
            ? t(`scope.empty.${field}`)
            : mode === 'filter'
              ? t(`scope.all.${field}`)
              : t('scope.choose');

        return (
          <SelectField
            key={field}
            label={t(LABEL_KEY[field])}
            value={scope.value[field]}
            onChange={(v) => scope.set(field, v)}
            busy={scope.loading[field]}
            // Disabled where a choice is impossible rather than merely empty —
            // §14.2: an inapplicable control teaches nothing, but the label
            // above still says *why*, which a hidden control could not.
            disabled={locked.includes(field) || unmetDependency !== undefined || isEmpty}
            options={[
              // `''` is offered in a filter (it means "all") and kept in a form
              // only until something is chosen, so a form cannot be submitted
              // half-filled without the placeholder having said so.
              { value: '', label: placeholder },
              ...list,
            ]}
          />
        );
      })}
    </>
  );
}

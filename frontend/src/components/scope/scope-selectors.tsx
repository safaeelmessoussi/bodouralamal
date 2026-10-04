import type { ReactNode } from 'react';

import { SelectField } from '../ui/field.js';
import { wholeCategoryOf } from '../../hooks/use-scope-options.js';
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
 * | List loading | the field is `busy`; the previous label stays |
 * | Nothing matches the other choices | says so — a true statement about the curriculum (*this level teaches no subjects*), never a bare empty list |
 *
 * The third is the one that mattered: it is the state that used to reach the
 * server as `SUBJECT_NOT_AT_LEVEL`, and presenting it as an empty dropdown would
 * leave an administrator guessing whether the platform was broken.
 */

const LABEL_KEY: Record<ScopeField, string> = {
  categoryId: 'scope.category',
  levelId: 'scope.level',
  subjectId: 'scope.subject',
  branchId: 'scope.branch',
  academicYearId: 'scope.academicYear',
  groupId: 'scope.group',
  surahId: 'scope.surah',
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
  /**
   * **R179 §3 — a field frozen to the ROW's own value**, shown as-is whatever
   * the hook currently offers or holds. `locked` only disables the control:
   * its value still came from the hook, which clears a Subject the moment its
   * Level moves — and on «تعديل العنصر» the representative Level of a
   * filter-built class moves once its circles load, so the frozen Subject
   * went blank and the save was refused with «اختاري المادة.» although the
   * Subject is never sent on an edit. A pinned field is disabled and reads
   * the row's value and label, and nothing else.
   */
  pinned?: Partial<Record<ScopeField, Option>>;
  /** R198 §3 — fields a form needs, marked * : what is missing is said by
   *  the field, not by a sentence above the button. */
  required?: readonly ScopeField[];
  /** What `''` reads in a form for a field that may stay empty («بدون سورة محددة»). */
  blankLabels?: Partial<Record<ScopeField, string>>;
}

export function ScopeSelectors({
  scope,
  fields,
  mode,
  locked = [],
  extraOptions = {},
  pinned = {},
  required = [],
  blankLabels = {},
}: ScopeSelectorsProps): ReactNode {
  return (
    <>
      {fields.map((field) => {
        const pin = pinned[field];
        if (pin !== undefined) {
          return (
            <SelectField
              key={field}
              label={t(LABEL_KEY[field])}
              value={pin.value}
              onChange={() => undefined}
              disabled
              options={[pin]}
            />
          );
        }
        /**
         * **No field waits for another** (SRS Revision 198 §3, the Owner,
         * 2026-10-04). Until R198 a form's Subject was disabled behind
         * «يُرجى اختيار المستوى أولًا» and a Group behind its Level and
         * Branch; now every list is open from the start and choosing in any
         * of them narrows the others (`scope-facets.ts`) — the Subject first
         * narrows the Levels to those that teach it.
         */
        const list = [...(extraOptions[field] ?? []), ...scope.options[field]];
        const isEmpty = !scope.loading[field] && list.length === 0;

        const placeholder = isEmpty
            ? field === 'subjectId' && wholeCategoryOf(scope.value.levelId) !== null
              ? t('scope.empty.wholeCategorySubject')
              : t(`scope.empty.${field}`)
            : mode === 'filter'
              ? t(`scope.all.${field}`)
              : (blankLabels[field] ?? t('scope.choose'));

        return (
          <SelectField
            key={field}
            label={t(LABEL_KEY[field])}
            value={scope.value[field]}
            onChange={(v) => scope.set(field, v)}
            busy={scope.loading[field]}
            required={required.includes(field)}
            // Disabled where a choice is impossible rather than merely empty —
            // §14.2: an inapplicable control teaches nothing, but the label
            // above still says *why*, which a hidden control could not.
            disabled={locked.includes(field) || isEmpty}
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

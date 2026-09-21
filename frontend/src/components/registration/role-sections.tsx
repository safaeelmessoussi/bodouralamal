import { useEffect, useState, type ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import type { CategoryRef } from '../../adapters/calendar.js';
import { fetchCircleSlots, type CircleSlots } from '../../adapters/registrations.js';
import { t } from '../../i18n/index.js';
import { BranchSelector } from '../ui/branch-selector.js';
import { CheckboxField, SelectField } from '../ui/field.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { CircleRanking } from './circle-ranking.js';

/**
 * **The three role sections, once** (SRS Revision 168 §1, shared by R169 §1).
 *
 * A person is asked the same things about «مستفيدة», «هيئة التدريس» and «هيئة
 * الإدارة» in two places: the registration form, before she has an account, and
 * «طلب صفة إضافية», after. Two copies of these fields would be two sets of
 * rules that drift — the children's section lost its repeatable behaviour to
 * exactly that once (R65). So the fields, their validation and the request body
 * they become live here, and both pages are callers.
 *
 * Presentation and pure functions only: nothing here submits anything.
 */

/* ── «مستفيدة» ─────────────────────────────────────────────────────────────── */

export interface StudentSectionValue {
  branchId: string | null;
  categoryId: string | null;
  /** «هل هذه أول مرة؟» — asked, never defaulted. */
  firstTime: '' | 'yes' | 'no';
  /** Her ranked circles, most convenient first. */
  circlePreferences: string[];
}

export const EMPTY_STUDENT_SECTION: StudentSectionValue = {
  branchId: null,
  categoryId: null,
  firstTime: '',
  circlePreferences: [],
};

/**
 * **What she may choose between is asked of the server, for HER Category and
 * branch** — the scheduled memorisation classes of that Category's first Level
 * there. A failed read offers nothing rather than blocking the form: the order
 * is a wish, and the administration places her either way. `onReset` fires
 * whenever the offer changes, because a ranking of circles no longer on offer
 * is not an answer.
 */
export function useCircleSlots(
  value: Pick<StudentSectionValue, 'branchId' | 'categoryId' | 'firstTime'>,
  enabled: boolean,
  onReset: () => void,
): CircleSlots | null {
  const [slots, setSlots] = useState<CircleSlots | null>(null);
  const wanted = enabled && value.firstTime === 'yes' && value.branchId && value.categoryId;
  useEffect(() => {
    setSlots(null);
    onReset();
    if (!wanted) return;
    let cancelled = false;
    void fetchCircleSlots(value.categoryId!, value.branchId!)
      .then((next) => {
        if (!cancelled) setSlots(next);
      })
      .catch(() => {
        if (!cancelled) setSlots({ level: null, circles: [], fixed: [] });
      });
    return () => {
      cancelled = true;
    };
    // `onReset` is the caller's setter and deliberately NOT a dependency:
    // re-running on its identity would reset her ranking on every render.
  }, [wanted, value.branchId, value.categoryId]);
  return slots;
}

export function StudentSectionFields({
  value,
  onChange,
  branches,
  categories,
  slots,
  errors,
}: {
  value: StudentSectionValue;
  onChange: (next: StudentSectionValue) => void;
  branches: PublicBranch[];
  categories: CategoryRef[];
  slots: CircleSlots | null;
  /** Keys: `branch`, `category`, `firstTime`, `circles`. Empty until touched. */
  errors: Record<string, string>;
}): ReactNode {
  return (
    <>
      <BranchSelector
        branches={branches}
        value={value.branchId}
        onChange={(branchId) => onChange({ ...value, branchId })}
        label={t('register.branchLabel')}
        allowAll={false}
        emptyLabel={t('register.branchEmpty')}
        required
        hint={t('register.branchHint')}
        error={errors['branch'] ?? null}
      />

      <SelectField
        label={t('register.categoryLabel')}
        value={value.categoryId ?? ''}
        onChange={(v) => onChange({ ...value, categoryId: v === '' ? null : v })}
        required
        options={[
          { value: '', label: t('register.categoryEmpty') },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
        hint={t('register.categoryHint')}
        error={errors['category'] ?? null}
      />

      {/* «هل هذه أول مرة؟» — a choice, never a default: a returning
          مستفيدة is placed by the administration, who know her. */}
      <SelectField
        label={t('register.firstTimeLabel')}
        value={value.firstTime}
        onChange={(next) =>
          onChange({
            ...value,
            firstTime: next as StudentSectionValue['firstTime'],
            circlePreferences: next === 'yes' ? value.circlePreferences : [],
          })
        }
        required
        options={[
          { value: '', label: t('common.choose') },
          { value: 'yes', label: t('register.firstTimeYes') },
          { value: 'no', label: t('register.firstTimeNo') },
        ]}
        hint={t('register.firstTimeHint')}
        error={errors['firstTime'] ?? null}
      />

      {value.firstTime === 'yes' && slots ? (
        <CircleRanking
          slots={slots}
          value={value.circlePreferences}
          onChange={(circlePreferences) => onChange({ ...value, circlePreferences })}
          error={errors['circles'] ?? null}
        />
      ) : null}
    </>
  );
}

/** §4.1 R39/R49 — a choice, never a default; R168 §1 — a first-timer orders at
 *  least one circle WHERE there is a choice to make. */
export function validateStudentSection(
  value: StudentSectionValue,
  circlesOffered: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!value.branchId) errors['branch'] = t('register.errBranch');
  if (!value.categoryId) errors['category'] = t('register.errCategory');
  if (value.firstTime === '') errors['firstTime'] = t('register.errRequired');
  if (value.firstTime === 'yes' && circlesOffered >= 2 && value.circlePreferences.length === 0) {
    errors['circles'] = t('register.errCircles');
  }
  return errors;
}

export function studentSectionPayload(value: StudentSectionValue): {
  branch_id: string;
  category_id: string;
  first_time: boolean;
  circle_preferences?: string[];
} {
  return {
    branch_id: value.branchId!,
    category_id: value.categoryId!,
    first_time: value.firstTime === 'yes',
    ...(value.firstTime === 'yes' && value.circlePreferences.length > 0
      ? { circle_preferences: value.circlePreferences }
      : {}),
  };
}

/* ── «هيئة التدريس» ───────────────────────────────────────────────────────── */

export interface TeachingSectionValue {
  mode: '' | 'in_person' | 'online' | 'both';
  allBranches: boolean;
  branchIds: string[];
}

export const EMPTY_TEACHING_SECTION: TeachingSectionValue = { mode: '', allBranches: false, branchIds: [] };

export function TeachingSectionFields({
  value,
  onChange,
  branches,
  errors,
}: {
  value: TeachingSectionValue;
  onChange: (next: TeachingSectionValue) => void;
  branches: PublicBranch[];
  /** Keys: `framingMode`, `framingBranches`. */
  errors: Record<string, string>;
}): ReactNode {
  return (
    <>
      {/* Said plainly rather than implied: submitting this asks for
          something a person has to grant. */}
      <p className="state" role="status">
        {t('register.teacherNotice')}
      </p>
      <SelectField
        label={t('register.framingModeLabel')}
        value={value.mode}
        onChange={(next) => {
          const mode = next as TeachingSectionValue['mode'];
          // Switching away CLEARS stale physical choices: a hidden branch list
          // is never trusted to a later payload builder to omit.
          onChange(
            mode === 'online' || mode === ''
              ? { mode, allBranches: false, branchIds: [] }
              : { ...value, mode },
          );
        }}
        required
        options={[
          { value: '', label: t('register.framingModeEmpty') },
          { value: 'in_person', label: t('register.framingMode_in_person') },
          { value: 'online', label: t('register.framingMode_online') },
          { value: 'both', label: t('register.framingMode_both') },
        ]}
        hint={t('register.framingModeHint')}
        error={errors['framingMode'] ?? null}
      />

      {value.mode === 'in_person' || value.mode === 'both' ? (
        <>
          <CheckboxField
            label={t('register.framingAllBranches')}
            checked={value.allBranches}
            onChange={(checked) =>
              onChange({ ...value, allBranches: checked, branchIds: checked ? [] : value.branchIds })
            }
            hint={t('register.framingAllBranchesHint')}
          />
          {value.allBranches ? null : (
            <MultiSelectField
              label={t('register.framingBranchesLabel')}
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              selected={value.branchIds}
              onChange={(branchIds) => onChange({ ...value, branchIds })}
              required
              hint={t('register.framingBranchesHint')}
              emptyLabel={t('register.framingBranchesEmpty')}
              error={errors['framingBranches'] ?? null}
            />
          )}
        </>
      ) : null}
    </>
  );
}

export function validateTeachingSection(value: TeachingSectionValue): Record<string, string> {
  const errors: Record<string, string> = {};
  if (value.mode === '') errors['framingMode'] = t('register.errFramingMode');
  if ((value.mode === 'in_person' || value.mode === 'both') && !value.allBranches && value.branchIds.length === 0) {
    errors['framingBranches'] = t('register.errFramingBranches');
  }
  return errors;
}

export type FramingPayload =
  | { mode: 'online' }
  | {
      mode: 'in_person' | 'both';
      willingness: { all_branches: true } | { all_branches: false; branch_ids: string[] };
    };

export function framingPayload(value: TeachingSectionValue): FramingPayload {
  const mode = value.mode as Exclude<TeachingSectionValue['mode'], ''>;
  return mode === 'online'
    ? { mode }
    : {
        mode,
        willingness: value.allBranches
          ? { all_branches: true as const }
          : { all_branches: false as const, branch_ids: value.branchIds },
      };
}

/* ── «هيئة الإدارة» ───────────────────────────────────────────────────────── */

/**
 * **She asks; she does not choose.** Which administrative role and over which
 * branches is the approving Super Admin's decision alone, so the section offers
 * no such control: only where she would prefer to serve, if anywhere.
 */
export function AdministrationSectionFields({
  branchId,
  onChange,
  branches,
}: {
  branchId: string | null;
  onChange: (branchId: string | null) => void;
  branches: PublicBranch[];
}): ReactNode {
  return (
    <>
      <p className="state" role="status">
        {t('register.administrationNotice')}
      </p>
      <BranchSelector
        branches={branches}
        value={branchId}
        onChange={onChange}
        label={t('register.administrationBranchLabel')}
        allowAll={false}
        emptyLabel={t('register.administrationBranchEmpty')}
        hint={t('register.administrationBranchHint')}
      />
    </>
  );
}

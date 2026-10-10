import { categoriesForSelf, categoryOptionLabel } from '../../lib/category-audience.js';
import { useEffect, useState, type ReactNode } from 'react';

import type { PublicBranch } from '../../adapters/branches.js';
import type { CategoryRef } from '../../adapters/calendar.js';
import { fetchCircleSlots, type CircleSlots } from '../../adapters/registrations.js';
import { t } from '../../i18n/index.js';
import { BranchSelector } from '../ui/branch-selector.js';
import { CheckboxField, DateField, SelectField } from '../ui/field.js';
import type { FramingPreferenceView } from '../../types/framing.js';
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
          // R170 §6 — she registers HERSELF: never a Category a guardian
          // registers into; each named with its age range where one is stated.
          ...categoriesForSelf(categories).map((c) => ({ value: c.id, label: categoryOptionLabel(c) })),
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
  /** R215 — when: '' not stated; the current year or semester; or two dates. */
  period: '' | 'academic_year' | 'academic_period' | 'date_range';
  from: string;
  until: string;
  /** R215 — main teacher, assistant, or either; '' not stated. */
  position: '' | 'teacher' | 'assistant' | 'both';
  /** R215 — every Level, or `levelIds`. */
  allLevels: boolean;
  levelIds: string[];
}

export const EMPTY_TEACHING_SECTION: TeachingSectionValue = {
  mode: '',
  allBranches: false,
  branchIds: [],
  period: '',
  from: '',
  until: '',
  position: '',
  allLevels: true,
  levelIds: [],
};

/** R215 — a saved preference, back into the form (dashboard and admin dialog). */
export function teachingSectionFrom(view: FramingPreferenceView | null): TeachingSectionValue {
  if (!view) return EMPTY_TEACHING_SECTION;
  return {
    mode: view.mode,
    allBranches: view.all_branches,
    branchIds: view.branches.map((b) => b.id),
    period: view.period?.kind ?? '',
    from: view.period?.kind === 'date_range' ? view.period.from : '',
    until: view.period?.kind === 'date_range' ? view.period.until : '',
    position: view.position ?? '',
    allLevels: view.all_levels ?? true,
    levelIds: (view.levels ?? []).map((l) => l.id),
  };
}

export function TeachingSectionFields({
  value,
  onChange,
  branches,
  levels = [],
  errors,
  notice = true,
}: {
  value: TeachingSectionValue;
  onChange: (next: TeachingSectionValue) => void;
  branches: Pick<PublicBranch, 'id' | 'name'>[];
  /** R215 — the Levels she may name, labelled `{Category} — {Level}`. */
  levels?: { id: string; label: string }[];
  /** Keys: `framingMode`, `framingBranches`, `framingPeriod`, `framingLevels`. */
  errors: Record<string, string>;
  /** The «asks for something a person grants» line — a request's, not an edit's. */
  notice?: boolean;
}): ReactNode {
  return (
    <>
      {/* Said plainly rather than implied: submitting this asks for
          something a person has to grant. */}
      {notice ? (
        <p className="state" role="status">
          {t('register.teacherNotice')}
        </p>
      ) : null}
      <SelectField
        label={t('register.framingModeLabel')}
        value={value.mode}
        onChange={(next) => {
          const mode = next as TeachingSectionValue['mode'];
          // Switching away CLEARS stale physical choices: a hidden branch list
          // is never trusted to a later payload builder to omit.
          onChange(
            mode === 'online' || mode === ''
              ? { ...value, mode, allBranches: false, branchIds: [] }
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

      {/* R215 — when, in which position, for which Levels. Each optional. */}
      <SelectField
        label={t('framing.periodLabel')}
        value={value.period}
        onChange={(next) => onChange({ ...value, period: next as TeachingSectionValue['period'] })}
        options={[
          { value: '', label: t('framing.unset') },
          { value: 'academic_year', label: t('framing.period_academic_year') },
          { value: 'academic_period', label: t('framing.period_academic_period') },
          { value: 'date_range', label: t('framing.period_date_range') },
        ]}
        error={errors['framingPeriod'] ?? null}
      />
      {value.period === 'date_range' ? (
        <div className="field-pair">
          <DateField label={t('framing.from')} value={value.from} onChange={(from) => onChange({ ...value, from })} required />
          <DateField
            label={t('framing.until')}
            value={value.until}
            onChange={(until) => onChange({ ...value, until })}
            required
            {...(value.from ? { min: value.from } : {})}
          />
        </div>
      ) : null}
      <SelectField
        label={t('framing.positionLabel')}
        value={value.position}
        onChange={(next) => onChange({ ...value, position: next as TeachingSectionValue['position'] })}
        options={[
          { value: '', label: t('framing.unset') },
          { value: 'teacher', label: t('framing.position_teacher') },
          { value: 'assistant', label: t('framing.position_assistant') },
          { value: 'both', label: t('framing.position_both') },
        ]}
      />
      <CheckboxField
        label={t('framing.allLevels')}
        checked={value.allLevels}
        onChange={(checked) => onChange({ ...value, allLevels: checked, levelIds: checked ? [] : value.levelIds })}
      />
      {value.allLevels ? null : (
        <MultiSelectField
          label={t('framing.levelsLabel')}
          options={levels.map((level) => ({ value: level.id, label: level.label }))}
          selected={value.levelIds}
          onChange={(levelIds) => onChange({ ...value, levelIds })}
          required
          error={errors['framingLevels'] ?? null}
        />
      )}
    </>
  );
}

export function validateTeachingSection(value: TeachingSectionValue): Record<string, string> {
  const errors: Record<string, string> = {};
  if (value.mode === '') errors['framingMode'] = t('register.errFramingMode');
  if ((value.mode === 'in_person' || value.mode === 'both') && !value.allBranches && value.branchIds.length === 0) {
    errors['framingBranches'] = t('register.errFramingBranches');
  }
  if (value.period === 'date_range' && (value.from === '' || value.until === '' || value.from > value.until)) {
    errors['framingPeriod'] = t('framing.errDates');
  }
  if (!value.allLevels && value.levelIds.length === 0) errors['framingLevels'] = t('framing.errLevels');
  return errors;
}

/** R215 — when, position and Levels, each sent only when stated. */
interface FramingExtras {
  period?: { kind: 'academic_year' } | { kind: 'academic_period' } | { kind: 'date_range'; from: string; until: string };
  position?: 'teacher' | 'assistant' | 'both';
  levels?: { all_levels: true } | { all_levels: false; level_ids: string[] };
}

export type FramingPayload =
  | ({ mode: 'online' } & FramingExtras)
  | ({
      mode: 'in_person' | 'both';
      willingness: { all_branches: true } | { all_branches: false; branch_ids: string[] };
    } & FramingExtras);

export function framingPayload(value: TeachingSectionValue): FramingPayload {
  const mode = value.mode as Exclude<TeachingSectionValue['mode'], ''>;
  const extras: FramingExtras = {
    ...(value.period === 'date_range'
      ? { period: { kind: 'date_range' as const, from: value.from, until: value.until } }
      : value.period !== ''
        ? { period: { kind: value.period } }
        : {}),
    ...(value.position !== '' ? { position: value.position } : {}),
    ...(value.allLevels ? {} : { levels: { all_levels: false as const, level_ids: value.levelIds } }),
  };
  return mode === 'online'
    ? { mode, ...extras }
    : {
        mode,
        willingness: value.allBranches
          ? { all_branches: true as const }
          : { all_branches: false as const, branch_ids: value.branchIds },
        ...extras,
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

/** R215 — the Levels a framing preference may name, `{Category} — {Level}`, from the public bootstrap. */
export function framingLevelOptions(bootstrap: {
  levels: { id: string; name: string; category_id: string }[];
  categories: { id: string; name: string }[];
}): { id: string; label: string }[] {
  const category = new Map(bootstrap.categories.map((c) => [c.id, c.name]));
  return bootstrap.levels.map((level) => ({
    id: level.id,
    label: category.has(level.category_id) ? `${category.get(level.category_id)} — ${level.name}` : level.name,
  }));
}

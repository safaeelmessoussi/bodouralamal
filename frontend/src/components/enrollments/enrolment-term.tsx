import { useEffect, useState, type ReactNode } from 'react';

import { listAcademicPeriods, type AcademicPeriodRef } from '../../adapters/academic-periods.js';
import { listAcademicYears, type AcademicYearRef } from '../../adapters/reference-data.js';
import { t } from '../../i18n/index.js';
import { ChoiceField, SelectField } from '../ui/field.js';

/**
 * **R271 — what a placement is for**: the whole academic year (the ordinary
 * path, the current year chosen) or one semester (the exception). Any year or
 * semester, past, present or future. The value is the request body's own key.
 */
export type EnrolmentTermValue = { academic_year_id: string } | { academic_period_id: string } | null;

export function useEnrolmentTerm(token: string | null): {
  value: EnrolmentTermValue;
  field: ReactNode;
} {
  const [kind, setKind] = useState<'year' | 'semester'>('year');
  const [years, setYears] = useState<AcademicYearRef[]>([]);
  const [periods, setPeriods] = useState<AcademicPeriodRef[]>([]);
  const [yearId, setYearId] = useState('');
  const [periodId, setPeriodId] = useState('');

  useEffect(() => {
    let live = true;
    void listAcademicYears(token)
      .then((rows) => {
        if (!live) return;
        setYears(rows);
        setYearId((chosen) => chosen || (rows.find((y) => y.is_current)?.id ?? ''));
      })
      .catch(() => undefined);
    void listAcademicPeriods(token)
      .then((rows) => {
        if (!live) return;
        setPeriods(rows);
        setPeriodId((chosen) => chosen || (rows.find((p) => p.is_current)?.id ?? ''));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  const value: EnrolmentTermValue =
    kind === 'year'
      ? yearId
        ? { academic_year_id: yearId }
        : null
      : periodId
        ? { academic_period_id: periodId }
        : null;

  const field = (
    <>
      <fieldset>
        <legend>{t('admin.enrollments.termLegend')}</legend>
        {(['year', 'semester'] as const).map((option) => (
          <ChoiceField
            key={option}
            type="radio"
            name="enrolment-term"
            label={t(option === 'year' ? 'admin.enrollments.termYear' : 'admin.enrollments.termSemester')}
            checked={kind === option}
            onChange={(on) => {
              if (on) setKind(option);
            }}
          />
        ))}
      </fieldset>
      {kind === 'year' ? (
        <SelectField
          label={t('admin.enrollments.yearLabel')}
          value={yearId}
          onChange={setYearId}
          required
          placeholder={t('admin.enrollments.periodPlaceholder')}
          options={years.map((y) => ({ value: y.id, label: y.label }))}
          hint={t('admin.enrollments.yearHint')}
        />
      ) : (
        <SelectField
          label={t('admin.enrollments.periodLabel')}
          value={periodId}
          onChange={setPeriodId}
          required
          placeholder={t('admin.enrollments.periodPlaceholder')}
          options={periods.map((p) => ({
            value: p.id,
            label: `${p.academic_year_label} — ${t('admin.enrollments.semester').replace('{n}', String(p.sequence))}`,
          }))}
        />
      )}
    </>
  );
  return { value, field };
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createAcademicPeriod,
  listAcademicPeriods,
  updateAcademicPeriod,
  type AcademicPeriodRef,
} from '../../adapters/academic-periods.js';
import { listAcademicYears, type AcademicYearRef } from '../../adapters/reference-data.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { DateField, SelectField, TextField } from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { isDirty } from '../../lib/form-dirty.js';

/**
 * **الفصول الدراسية — the semesters an academic year is made of** (SRS R122).
 *
 * ## Why this screen exists
 *
 * An `Enrollment` names the period it belongs to, and **the seed creates no
 * periods**: the association's semester boundaries are a fact about its own
 * calendar, and inventing them would be indistinguishable a year later from
 * boundaries it actually ran. That decision is only honest if the person who
 * knows them can enter them — a required field with no screen behind it is the
 * project's recurring defect (rule P), and it would have made approval refuse
 * every applicant with nothing an administrator could do about it.
 *
 * ## Data-first (rule A)
 *
 * Every period is listed immediately. The year filter **narrows** the list; it
 * is never the precondition for it appearing, and `academic_year_id` is
 * optional on the API for the same reason.
 *
 * ## جارٍ is read, never stored
 *
 * `is_current` comes from the server, derived from the period's own dates on
 * every request. A stored flag would need a job to maintain it, and a job that
 * fails leaves a row asserting something false about today.
 *
 * ## There is no delete, deliberately
 *
 * A semester the association ran is a fact, and enrolments point at it under
 * `ON DELETE RESTRICT`. A mistyped date is corrected by editing; a period that
 * never happened and holds no enrolments is a case nobody has had, and adding a
 * destructive action for it would put one beside rows that must never take it.
 */
export function AcademicPeriodsPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role, never the account's full list. The server enforces
  // the matrix regardless; this is UX (rule O).
  const canWrite = activeRoles.includes('super_admin');

  const [rows, setRows] = useState<AcademicPeriodRef[]>([]);
  const [years, setYears] = useState<AcademicYearRef[]>([]);
  const [yearFilter, setYearFilter] = useState('');
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AcademicPeriodRef | 'new' | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setRows(
        await listAcademicPeriods(
          accessToken,
          yearFilter ? { academic_year_id: yearFilter } : {},
        ),
      );
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, yearFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The years are the form's source and the filter's; a failure leaves both
    // empty rather than the table, which stays readable either way.
    void listAcademicYears(accessToken)
      .then(setYears)
      .catch(() => setYears([]));
  }, [accessToken]);

  async function save(
    input: { academic_year_id: string; sequence: number; start_date: string; end_date: string },
    existing: AcademicPeriodRef | null,
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) {
        await updateAcademicPeriod(
          existing.id,
          existing.version,
          {
            sequence: input.sequence,
            start_date: input.start_date,
            end_date: input.end_date,
          },
          accessToken,
        );
      } else {
        await createAcademicPeriod(input, accessToken);
      }
      setEditing(null);
      await load();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      /**
       * Three refusals reach here and they are not the same event, so they do
       * not share a sentence: an overlap is a decision the administrator can
       * correct on the spot, a duplicate sequence names a period that already
       * exists, and a stale version means somebody else moved the row.
       */
      const reason =
        error instanceof ApiError
          ? (error.details as { reason?: string } | undefined)?.reason
          : undefined;
      if (reason === 'ACADEMIC_PERIOD_OVERLAP') {
        setNotice(t('admin.academicPeriods.overlap'));
      } else if (error instanceof ApiError && error.code === 'DUPLICATE') {
        setNotice(t('admin.academicPeriods.duplicate'));
      } else if (error instanceof ApiError && error.status === 409) {
        setNotice(t('common.conflict'));
        setEditing(null);
        await load();
      } else {
        setNotice(t('common.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AcademicPeriodRef>[] = [
    {
      key: 'academic_year_label',
      header: t('admin.academicPeriods.colYear'),
      cell: (r) => r.academic_year_label,
    },
    {
      key: 'sequence',
      header: t('admin.academicPeriods.colSequence'),
      cell: (r) => t('admin.enrollments.semester').replace('{n}', String(r.sequence)),
    },
    {
      key: 'start_date',
      header: t('admin.academicPeriods.colStart'),
      cell: (r) => r.start_date,
    },
    {
      key: 'end_date',
      header: t('admin.academicPeriods.colEnd'),
      cell: (r) => r.end_date,
    },
    {
      key: 'is_current',
      header: t('admin.academicPeriods.colState'),
      cell: (r) => (
        <Badge tone={r.is_current ? 'ok' : 'neutral'}>
          {t(r.is_current ? 'admin.enrollments.currentBadge' : 'admin.enrollments.endedBadge')}
        </Badge>
      ),
    },
  ];

  const actions: RowAction<AcademicPeriodRef>[] = canWrite
    ? [{ label: t('common.edit'), onSelect: (r) => setEditing(r) }]
    : [];

  return (
    <AdminLayout
      title={t('admin.academicPeriods.title')}
      lede={t('admin.academicPeriods.lede')}
      actions={
        canWrite ? (
          <Button variant="add" onClick={() => setEditing('new')} disabled={years.length === 0}>
            {t('admin.academicPeriods.create')}
          </Button>
        ) : null
      }
    >
      {notice ? <Feedback>{notice}</Feedback> : null}

      <SelectField
        label={t('admin.academicPeriods.filterYear')}
        value={yearFilter}
        onChange={setYearFilter}
        options={[
          { value: '', label: t('admin.academicPeriods.allYears') },
          ...years.map((y) => ({ value: y.id, label: y.label })),
        ]}
      />

      <DataTable
        caption={t('admin.academicPeriods.title')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
      />

      {editing ? (
        <AcademicPeriodFormDialog
          initial={editing === 'new' ? null : editing}
          years={years}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}
    </AdminLayout>
  );
}

function AcademicPeriodFormDialog({
  initial,
  years,
  busy,
  onSave,
  onCancel,
}: {
  initial: AcademicPeriodRef | null;
  years: AcademicYearRef[];
  busy: boolean;
  onSave: (input: {
    academic_year_id: string;
    sequence: number;
    start_date: string;
    end_date: string;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const [yearId, setYearId] = useState(
    initial?.academic_year_id ?? years.find((y) => y.is_current)?.id ?? years[0]?.id ?? '',
  );
  const [sequence, setSequence] = useState(String(initial?.sequence ?? 1));
  const [startDate, setStartDate] = useState(initial?.start_date ?? '');
  const [endDate, setEndDate] = useState(initial?.end_date ?? '');
  const [touched, setTouched] = useState(false);

  const sequenceNumber = Number(sequence);
  const sequenceError =
    !Number.isInteger(sequenceNumber) || sequenceNumber < 1
      ? t('admin.academicPeriods.sequenceInvalid')
      : null;
  const startError = startDate === '' ? t('common.required') : null;
  // The end date is INCLUSIVE, so the same day is a legal one-day period.
  const endError =
    endDate === ''
      ? t('common.required')
      : endDate < startDate
        ? t('admin.academicPeriods.endBeforeStart')
        : null;
  const yearError = yearId === '' ? t('common.required') : null;
  const invalid = sequenceError ?? startError ?? endError ?? yearError;

  // Every field the form holds — a `dirty` that missed one would let the
  // unsaved-changes guard throw away exactly the change just made (rule AY).
  const dirty = isDirty(
    { yearId, sequence, startDate, endDate },
    {
      yearId: initial?.academic_year_id ?? years.find((y) => y.is_current)?.id ?? years[0]?.id ?? '',
      sequence: String(initial?.sequence ?? 1),
      startDate: initial?.start_date ?? '',
      endDate: initial?.end_date ?? '',
    },
  );

  function submit(): void {
    setTouched(true);
    if (invalid) return;
    onSave({
      academic_year_id: yearId,
      sequence: sequenceNumber,
      start_date: startDate,
      end_date: endDate,
    });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t(initial ? 'admin.academicPeriods.edit' : 'admin.academicPeriods.create')}
      busy={busy}
      dirty={dirty}
    >
      {initial ? (
        /**
         * **Shown as text, with the line that says which action does change it**
         * (rule AF). The route refuses `academic_year_id` on a patch outright:
         * moving a period into another year would re-file every enrolment that
         * names it, which is a re-creation rather than an edit.
         */
        <p className="field">
          <span className="field__label">{t('admin.academicPeriods.colYear')}</span>
          <span>{initial.academic_year_label}</span>
          <span className="hint">{t('admin.academicPeriods.yearFixed')}</span>
        </p>
      ) : (
        <SelectField
          label={t('admin.academicPeriods.colYear')}
          value={yearId}
          onChange={setYearId}
          required
          error={touched ? yearError : null}
          options={years.map((y) => ({ value: y.id, label: y.label }))}
        />
      )}

      <TextField
        label={t('admin.academicPeriods.colSequence')}
        value={sequence}
        onChange={setSequence}
        required
        hint={t('admin.academicPeriods.sequenceHint')}
        error={touched ? sequenceError : null}
      />

      <DateField
        label={t('admin.academicPeriods.colStart')}
        value={startDate}
        onChange={setStartDate}
        required
        error={touched ? startError : null}
      />

      <DateField
        label={t('admin.academicPeriods.colEnd')}
        value={endDate}
        onChange={setEndDate}
        required
        hint={t('admin.academicPeriods.endHint')}
        error={touched ? endError : null}
      />
    </FormDialog>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createAcademicPeriod,
  listAcademicPeriods,
  updateAcademicPeriod,
  type AcademicPeriodRef,
} from '../../adapters/academic-periods.js';
import {
  createAcademicYear,
  deleteAcademicYear,
  listAcademicYears,
  updateAcademicYear,
  type AcademicYearRef,
} from '../../adapters/reference-data.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Badge } from '../../components/ui/badge.js';
import { BlockedNotice } from '../../components/ui/blocked-notice.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { CheckboxField, DateField, SelectField, TextField } from '../../components/ui/field.js';
import { Feedback } from '../../components/ui/feedback.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';
import { classifyDeletion, deletionNotice } from '../../lib/deletion-outcome.js';
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
  const [yearsStatus, setYearsStatus] = useState<TableStatus>('loading');
  const [yearFilter, setYearFilter] = useState('');
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AcademicPeriodRef | 'new' | null>(null);
  // R137 — the years themselves, managed on this same page.
  const [editingYear, setEditingYear] = useState<AcademicYearRef | 'new' | null>(null);
  const [deletingYear, setDeletingYear] = useState<AcademicYearRef | null>(null);
  const [blockedYear, setBlockedYear] = useState<unknown>(null);

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

  const loadYears = useCallback(async () => {
    setYearsStatus('loading');
    try {
      setYears(await listAcademicYears(accessToken));
      setYearsStatus('ready');
    } catch {
      setYearsStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  /**
   * **R137 — creating or renaming a year here reflects instantly through
   * `يبدأ في`'s own selector**, without a page reload: `إضافة فصل` reads the
   * SAME `years` state, so a year created for exactly this purpose is
   * immediately choosable rather than requiring a refresh first.
   */
  async function saveYear(
    input: { label: string; is_current: boolean },
    existing: AcademicYearRef | null,
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) {
        await updateAcademicYear(
          existing.id,
          existing.version,
          { label: input.label, is_current: input.is_current },
          accessToken,
        );
      } else {
        await createAcademicYear(
          { label: input.label, is_current: input.is_current },
          accessToken,
        );
      }
      setEditingYear(null);
      await loadYears();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE') {
        setNotice(t('admin.academicYears.duplicate'));
      } else if (error instanceof ApiError && error.status === 409) {
        setNotice(t('common.conflict'));
        setEditingYear(null);
        await loadYears();
      } else {
        setNotice(t('common.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteYear(): Promise<void> {
    if (!deletingYear) return;
    setBusy(true);
    try {
      await deleteAcademicYear(deletingYear.id, accessToken);
      setDeletingYear(null);
      await loadYears();
      setNotice(t('admin.academicYears.deleted'));
    } catch (error) {
      /**
       * **The current-year refusal is a distinct event, not a dependency
       * list** (`ACADEMIC_YEAR_IS_CURRENT`, no `blocked_by`): named ahead of
       * `classifyDeletion`, whose generic conflict sentence would otherwise
       * tell her to refresh — which does not resolve *this* one either.
       */
      const reason =
        error instanceof ApiError
          ? (error.details as { reason?: string } | undefined)?.reason
          : undefined;
      if (reason === 'ACADEMIC_YEAR_IS_CURRENT') {
        setNotice(t('admin.academicYears.isCurrentCannotDelete'));
        setDeletingYear(null);
        setBusy(false);
        return;
      }
      const outcome = classifyDeletion(error);
      if (outcome.kind === 'blocked') {
        // Stays open and names what blocks it, same as every other
        // reference-data deletion (rule AZ.1).
        setBlockedYear(error);
        setBusy(false);
        return;
      }
      setDeletingYear(null);
      if (outcome.kind === 'already-gone') await loadYears();
      setNotice(deletionNotice(outcome));
    } finally {
      setBusy(false);
    }
  }

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
      } else if (
        /**
         * **The sequence is taken — matched on the REASON, not the code.**
         *
         * The service raises `STATE_CONFLICT` with
         * `ACADEMIC_PERIOD_SEQUENCE_TAKEN`, and this branch used to test
         * `code === 'DUPLICATE'` only. So a taken sequence fell through to the
         * generic 409 arm and told her *«تم تعديل هذا العنصر… يرجى تحديث
         * الصفحة»* — a concurrency sentence for a domain fact — **and closed the
         * dialog**, discarding everything she had typed for a conflict she fixes
         * by changing one number.
         *
         * The dialog therefore stays open here, unlike the stale-version arm
         * below where reloading genuinely is the remedy.
         */
        reason === 'ACADEMIC_PERIOD_SEQUENCE_TAKEN' ||
        (error instanceof ApiError && error.code === 'DUPLICATE')
      ) {
        setNotice(
          t('admin.academicPeriods.duplicate').replace('{sequence}', String(input.sequence)),
        );
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

  const yearColumns: Column<AcademicYearRef>[] = [
    { key: 'label', header: t('admin.academicYears.colLabel'), cell: (y) => y.label },
    {
      key: 'is_current',
      header: t('admin.academicYears.colState'),
      cell: (y) => (
        <Badge tone={y.is_current ? 'ok' : 'neutral'}>
          {y.is_current
            ? t('admin.academicYears.currentBadge')
            : t('admin.enrollments.endedBadge')}
        </Badge>
      ),
    },
  ];

  const yearActions: RowAction<AcademicYearRef>[] = canWrite
    ? [
        { label: t('common.edit'), onSelect: (y) => setEditingYear(y) },
        {
          label: t('common.delete'),
          onSelect: (y) => {
            setDeletingYear(y);
            setBlockedYear(null);
          },
        },
      ]
    : [];

  return (
    <AdminLayout
      title={t('admin.academicPeriods.title')}
      lede={t('admin.academicPeriods.lede')}
      actions={
        canWrite ? (
          <>
            <Button variant="add" onClick={() => setEditingYear('new')}>
              {t('admin.academicYears.create')}
            </Button>
            <Button variant="add" onClick={() => setEditing('new')} disabled={years.length === 0}>
              {t('admin.academicPeriods.create')}
            </Button>
          </>
        ) : null
      }
    >
      {notice ? <Feedback>{notice}</Feedback> : null}

      {/* **R137 — السنة الدراسية → الفصول الدراسية, one coherent surface.**
          Years are managed here, above the semesters they contain, so
          إضافة فصل's own year selector is never limited to whichever single
          row the seed happened to create — a previous, current or future year
          is created here first, then chosen below like any other. */}
      <section aria-labelledby="academic-years-heading">
        <h2 id="academic-years-heading">{t('admin.academicYears.title')}</h2>
        <p className="muted">{t('admin.academicYears.lede')}</p>

        <DataTable
          caption={t('admin.academicYears.title')}
          columns={yearColumns}
          rows={years}
          rowKey={(y) => y.id}
          status={yearsStatus}
          actions={yearActions}
          onRetry={() => void loadYears()}
        />
      </section>

      <section aria-labelledby="academic-periods-heading">
        <h2 id="academic-periods-heading">{t('admin.academicPeriods.title')}</h2>

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
      </section>

      {editingYear ? (
        <AcademicYearFormDialog
          initial={editingYear === 'new' ? null : editingYear}
          busy={busy}
          onCancel={() => setEditingYear(null)}
          onSave={(input) => void saveYear(input, editingYear === 'new' ? null : editingYear)}
        />
      ) : null}

      <ConfirmDialog
        open={deletingYear !== null}
        {...(blockedYear
          ? {
              blocked: (
                <BlockedNotice
                  error={blockedYear}
                  item={t('admin.academicYears.deleteBody').replace(
                    '{label}',
                    deletingYear?.label ?? '',
                  )}
                />
              ),
            }
          : {})}
        title={t('admin.academicYears.deleteTitle')}
        body={t('admin.academicYears.deleteBody').replace('{label}', deletingYear?.label ?? '')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDeleteYear()}
        onCancel={() => {
          setDeletingYear(null);
          setBlockedYear(null);
        }}
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

/**
 * **R137 — the same YYYY-YYYY-consecutive-pair rule the server enforces**
 * (`assertSequentialLabel`, `reference-data.service.ts`), checked here too so
 * a reader sees why before she ever submits, not only after a round trip.
 * Exported so it is tested directly rather than only through the rendered
 * form — the same discipline `weekdaysForClass` follows.
 */
export function academicYearLabelError(label: string): string | null {
  const match = /^(\d{4})-(\d{4})$/.exec(label);
  if (!match) return t('admin.academicYears.labelInvalid');
  const [, first, second] = match as unknown as [string, string, string];
  return Number(second) === Number(first) + 1 ? null : t('admin.academicYears.labelInvalid');
}

function AcademicYearFormDialog({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: AcademicYearRef | null;
  busy: boolean;
  onSave: (input: { label: string; is_current: boolean }) => void;
  onCancel: () => void;
}): ReactNode {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [isCurrent, setIsCurrent] = useState(initial?.is_current ?? false);
  const [touched, setTouched] = useState(false);

  const labelError = academicYearLabelError(label);
  const invalid = labelError;

  const dirty = isDirty(
    { label, isCurrent },
    { label: initial?.label ?? '', isCurrent: initial?.is_current ?? false },
  );

  function submit(): void {
    setTouched(true);
    if (invalid) return;
    onSave({ label, is_current: isCurrent });
  }

  return (
    <FormDialog
      open
      onCancel={onCancel}
      onSubmit={submit}
      title={t(initial ? 'admin.academicYears.edit' : 'admin.academicYears.create')}
      busy={busy}
      dirty={dirty}
    >
      <TextField
        label={t('admin.academicYears.colLabel')}
        value={label}
        onChange={setLabel}
        required
        hint={t('admin.academicYears.labelHint')}
        error={touched ? labelError : null}
      />

      <CheckboxField
        label={t('admin.academicYears.isCurrent')}
        checked={isCurrent}
        onChange={setIsCurrent}
        hint={t('admin.academicYears.isCurrentHint')}
      />
    </FormDialog>
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

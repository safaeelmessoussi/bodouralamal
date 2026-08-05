import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  createCourseSchedule,
  deleteCourseSchedule,
  listCourseSchedules,
  readConflicts,
  readScheduleRoster,
  updateCourseSchedule,
  type CourseSchedule,
  type Materialization,
  type ScheduleConflict,
  type ScheduleRosterEntry,
} from '../../adapters/course-schedules.js';
import {
  listAdministrativeGroups,
  type AdministrativeGroup,
} from '../../adapters/administrative-groups.js';
import { fetchCalendarBootstrap, type BranchRef, type LevelRef } from '../../adapters/calendar.js';
import {
  listAcademicYears,
  listSubjects,
  type AcademicYearRef,
  type SubjectRef,
} from '../../adapters/reference-data.js';
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { Button } from '../../components/ui/button.js';
import {
  RecurrenceEditor,
  SchedulingTimes,
} from '../../components/scheduling/recurrence-editor.js';
import { SelectField, TextField } from '../../components/ui/field.js';
import { ApiError } from '../../lib/api.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';

/**
 * `/admin/schedules` — Course Schedules (§5.6, §14.1 Academic, Revision 43).
 *
 * **The §14.1 node existed and this screen did not.** The module registry is
 * meant to hold that sitemap as data, and Course Schedules was missing from it
 * entirely — so the sidebar could not offer a section the specification lists.
 *
 * **Read, conflicts and audience — not create.** A schedule's write form is a
 * larger screen in its own right (subject, mode and its single target, room,
 * staff, times, recurrence, with conflict reporting on save), and shipping half
 * a form would leave the module claiming a capability it does not have. This
 * screen is complete on its own terms: an administrator can see the timetable,
 * ask what clashes, ask who a class is for, and remove a schedule.
 *
 * Two panels exist because the questions are genuinely different and neither
 * belongs in a table cell:
 *
 * - **Conflicts** are computed against *materialized Sessions*, never against
 *   recurrence rules — the panel says so, because "no conflicts" from a rule
 *   comparison and from a real comparison are not the same assurance.
 * - **The roster is resolved live**, not stored, so the panel says that too:
 *   a reader who thinks they are looking at a saved list will not understand
 *   why it changed.
 */
/**
 * The wall-clock label, rendered **exactly as the API sent it** (TD-11).
 *
 * Exported so a test can hold the line: parsing these through `Date` is how a
 * 15:00 class becomes 14:00 for a reader in another timezone, and it is the
 * single most tempting "improvement" to make to this cell.
 */
export function timeLabel(schedule: Pick<CourseSchedule, 'start_time' | 'end_time'>): string {
  return `${schedule.start_time} – ${schedule.end_time}`;
}

/** The weekday list when there is one, otherwise the recurrence rule's own name. */
export function recurrenceLabel(
  schedule: Pick<CourseSchedule, 'weekdays' | 'recurrence'>,
): string {
  return schedule.weekdays.length > 0 ? schedule.weekdays.join('، ') : schedule.recurrence;
}

export function SchedulesPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<CourseSchedule[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [conflicts, setConflicts] = useState<ScheduleConflict[] | null>(null);
  const [editing, setEditing] = useState<CourseSchedule | 'new' | null>(null);
  const [written, setWritten] = useState<Materialization | null>(null);
  const [roster, setRoster] = useState<ScheduleRosterEntry[] | null>(null);
  const [deleting, setDeleting] = useState<CourseSchedule | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listCourseSchedules(accessToken, page);
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<CourseSchedule>[] = [
    {
      key: 'time',
      header: t('admin.schedules.time'),
      // Wall-clock, rendered exactly as the API sends it (TD-11). Reformatting
      // through a Date here is how a 15:00 class becomes 14:00 for a reader in
      // another zone.
      cell: (r) => timeLabel(r),
    },
    {
      key: 'mode',
      header: t('admin.schedules.mode'),
      cell: (r) => t(`admin.schedules.mode_${r.teaching_mode}`),
    },
    {
      key: 'recurrence',
      header: t('admin.schedules.recurrence'),
      secondary: true,
      cell: (r) => recurrenceLabel(r),
    },
    {
      key: 'room',
      header: t('admin.schedules.room'),
      secondary: true,
      cell: (r) =>
        r.room_id ?? <span className="muted">{t('admin.schedules.noRoom')}</span>,
    },
    {
      key: 'staff',
      header: t('admin.schedules.staff'),
      numeric: true,
      secondary: true,
      cell: (r) => r.staff.length,
    },
  ];

  const actions: RowAction<CourseSchedule>[] = [
    {
      // R50's scope dialog lives behind this: editing one occurrence has to
      // start from a list of occurrences.
      label: t('admin.schedules.viewSessions'),
      onSelect: (r) => {
        window.location.href = `/admin/schedules/${r.id}/sessions`;
      },
    },
    {
      label: t('admin.schedules.viewConflicts'),
      onSelect: (r) => {
        void (async () => {
          setConflicts([]);
          const result = await readConflicts(r.id, accessToken);
          setConflicts(result.conflicts);
        })();
      },
    },
    {
      label: t('admin.schedules.viewRoster'),
      onSelect: (r) => {
        void (async () => {
          setRoster([]);
          const result = await readScheduleRoster(r.id, accessToken);
          setRoster(result.students);
        })();
      },
    },
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    { label: t('admin.schedules.remove'), danger: true, onSelect: (r) => setDeleting(r) },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await deleteCourseSchedule(deleting.id, accessToken);
      setDeleting(null);
      await load();
      // `retained` is reported, not swallowed: those Sessions hold work that
      // outlives the schedule, and the count is unavailable afterwards.
      setNotice(
        t('admin.schedules.deleted')
          .replace('{removed}', String(result.future_removed))
          .replace('{retained}', String(result.retained)),
      );
    } catch {
      setNotice(t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.schedules')}
      actions={<Button onClick={() => setEditing('new')}>{t('admin.schedules.create')}</Button>}
    >
      <p className="lede">{t('admin.schedules.lede')}</p>
      {notice ? <p role="status">{notice}</p> : null}

      <DataTable
        caption={t('admin.schedules.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      <Dialog
        open={conflicts !== null}
        onClose={() => setConflicts(null)}
        title={t('admin.schedules.conflictsTitle')}
      >
        <p className="lede">{t('admin.schedules.conflictsLede')}</p>
        {conflicts && conflicts.length === 0 ? (
          <p>{t('admin.schedules.conflictsEmpty')}</p>
        ) : (
          <ul>
            {(conflicts ?? []).map((c) => (
              <li key={`${c.session_id}-${c.kind}-${c.resource_id}`}>
                <time dateTime={c.date}>{c.date}</time> — {t(`admin.schedules.conflictKind_${c.kind}`)}
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog
        open={roster !== null}
        onClose={() => setRoster(null)}
        title={t('admin.schedules.rosterTitle')}
      >
        <p className="lede">{t('admin.schedules.rosterLede')}</p>
        {roster && roster.length === 0 ? (
          <p>{t('admin.schedules.rosterEmpty')}</p>
        ) : (
          <ul>
            {(roster ?? []).map((s) => (
              <li key={s.student_id}>{s.name ?? s.student_id}</li>
            ))}
          </ul>
        )}
      </Dialog>

      <ScheduleDialog
        open={editing !== null}
        schedule={editing === 'new' ? null : editing}
        token={accessToken}
        onDone={(report) => {
          setEditing(null);
          setWritten(report);
          void load();
        }}
        onCancel={() => setEditing(null)}
      />

      <MaterializationDialog report={written} onClose={() => setWritten(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.schedules.deleteTitle')}
        body={t('admin.schedules.deleteBody')}
        confirmLabel={t('common.delete')}
        danger
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </AdminLayout>
  );
}

const MODES = ['entire_level', 'administrative_group', 'teaching_group'] as const;
// The recurrence vocabulary and the weekday list moved to
// `components/scheduling/recurrence-editor.tsx`, which both scheduling screens
// now render — one implementation, one look, and one place a new pattern is
// added.

/**
 * Create and edit a schedule.
 *
 * **The form offers exactly what each verb accepts.** On edit, Subject, mode,
 * target, branch and academic year are disabled: the server *rejects* them
 * rather than dropping them, because each would re-point Sessions already
 * materialized against the old answer. Only the *when* and the *room* remain,
 * which is precisely what §4.4 promises rewrites future Sessions.
 *
 * **The target picker follows the mode**, because §4.4c gives a schedule exactly
 * one target of the kind the mode names. A single control that changes meaning
 * is the honest rendering of one field that changes meaning — two coexisting
 * pickers would let a user fill both and imply a choice the model does not have.
 *
 * **`teaching_group` mode is deliberately not offered here.** Choosing one needs
 * a Level *and* a Subject to reach `/admin/levels/{id}/subjects/{id}/teaching-groups`,
 * which is the Subject Organisation screen's own job (§14.1). Offering the mode
 * without a way to pick its target would be a control that cannot be completed.
 */
function ScheduleDialog({
  open,
  schedule,
  token,
  onDone,
  onCancel,
}: {
  open: boolean;
  schedule: CourseSchedule | null;
  token: string | null;
  onDone: (report: Materialization) => void;
  onCancel: () => void;
}): ReactNode {
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [years, setYears] = useState<AcademicYearRef[]>([]);
  const [levels, setLevels] = useState<LevelRef[]>([]);
  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  const [teachers, setTeachers] = useState<UserSummary[]>([]);

  const [subjectId, setSubjectId] = useState('');
  const [mode, setMode] = useState<string>('administrative_group');
  const [targetId, setTargetId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [yearId, setYearId] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [recurrence, setRecurrence] = useState('weekly');
  const [weekdays, setWeekdays] = useState<string[]>(['monday']);
  const [teacherId, setTeacherId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [s, y, g, u] = await Promise.all([
        listSubjects(token),
        listAcademicYears(token),
        listAdministrativeGroups(token, 1),
        searchUsers(token, { role: 'teacher' }),
      ]);
      setSubjects(s);
      setYears(y);
      setGroups(g.data);
      setTeachers(u.data);
      try {
        const bootstrap = await fetchCalendarBootstrap({ from: today, to: today });
        setLevels(bootstrap.levels);
        setBranches(bootstrap.branches);
      } catch {
        // Pickers stay empty; the dialog still functions for the rest.
      }
      // Default to the live year rather than asking an administrator which it
      // is — the single reason `is_current` is on the selector contract.
      setYearId((current) => current || (y.find((x) => x.is_current)?.id ?? ''));
    })();
  }, [open, token]);

  useEffect(() => {
    if (!schedule) return;
    setSubjectId(schedule.subject_id);
    setMode(schedule.teaching_mode);
    setTargetId(schedule.target_id);
    setBranchId(schedule.branch_id);
    setYearId(schedule.academic_year_id);
    setStart(schedule.start_time);
    setEnd(schedule.end_time);
    setRecurrence(schedule.recurrence);
    setWeekdays(schedule.weekdays);
  }, [schedule]);

  const fixed = schedule !== null;
  const targets =
    mode === 'entire_level'
      ? levels.map((l) => ({ id: l.id, name: l.name }))
      : groups.map((g) => ({ id: g.id, name: g.name }));

  const complete =
    subjectId !== '' && targetId !== '' && branchId !== '' && yearId !== '' && start !== '' && end !== '';

  async function submit(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = schedule
        ? await updateCourseSchedule(
            schedule.id,
            schedule.version,
            { start_time: start, end_time: end, recurrence, weekdays },
            token,
          )
        : await createCourseSchedule(
            {
              subject_id: subjectId,
              teaching_mode: mode,
              target_id: targetId,
              branch_id: branchId,
              academic_year_id: yearId,
              start_time: start,
              end_time: end,
              recurrence,
              weekdays,
              ...(teacherId ? { staff: [{ user_id: teacherId, position: 'teacher' }] } : {}),
            },
            token,
          );
      onDone(result.materialization);
    } catch (error) {
      // A booking clash is the interesting failure and has its own code: the
      // room or a person is already committed on a materialized date, which is
      // a different remedy from any other refusal.
      if (error instanceof ApiError && error.code === 'SCHEDULE_CONFLICT') {
        setNotice(t('admin.schedules.clash'));
      } else if (error instanceof ApiError && error.status === 409) {
        setNotice(t('common.conflict'));
      } else {
        setNotice(t('common.saveFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t(schedule ? 'admin.schedules.editTitle' : 'admin.schedules.create')}
      wide
    >
      {notice ? <p role="status">{notice}</p> : null}

      {/* **The shared field primitives, exactly as the Events form uses them.**
          These were six hand-rolled `<label><select>` blocks, which is why the
          two scheduling screens looked like different products: a raw control
          carries no label association, no hint slot and no error slot, so it
          spaces and behaves differently from every other form in the platform
          (constitution §4.3). The MODEL fields below stay different — that is
          the honest part — while the way they are asked no longer does. */}
      <SelectField
        label={t('admin.schedules.subject')}
        value={subjectId}
        onChange={setSubjectId}
        disabled={fixed}
        options={[
          { value: '', label: t('common.choose') },
          ...subjects.map((s) => ({ value: s.id, label: s.name })),
        ]}
      />

      <SelectField
        label={t('admin.schedules.mode')}
        value={mode}
        disabled={fixed}
        onChange={(v: string) => {
          setMode(v);
          // The target belongs to the mode; keeping the old id would submit an
          // entity of the wrong kind.
          setTargetId('');
        }}
        options={MODES.filter((m) => m !== 'teaching_group' || fixed).map((m) => ({
          value: m,
          label: t(`admin.schedules.mode_${m}`),
        }))}
      />

      <SelectField
        label={t('admin.schedules.target')}
        value={targetId}
        onChange={setTargetId}
        disabled={fixed}
        options={[
          { value: '', label: t('common.choose') },
          ...targets.map((x) => ({ value: x.id, label: x.name })),
        ]}
      />

      <SelectField
        label={t('admin.schedules.branch')}
        value={branchId}
        onChange={setBranchId}
        disabled={fixed}
        options={[
          { value: '', label: t('common.choose') },
          ...branches.map((b) => ({ value: b.id, label: b.name })),
        ]}
      />

      <SelectField
        label={t('admin.schedules.year')}
        value={yearId}
        onChange={setYearId}
        disabled={fixed}
        options={[
          { value: '', label: t('common.choose') },
          ...years.map((y) => ({ value: y.id, label: y.label })),
        ]}
      />

      {fixed ? <p className="muted">{t('admin.schedules.fixedAfterCreate')}</p> : null}

      {/* Typed as text, not `type="time"`: TD-11 wall-clock values travel as
          `HH:MM` strings, and a native time input in some locales hands back a
          12-hour rendering. The server validates the format regardless. */}
      {/* **The SAME components the events form uses** (§4.4). The two models
          differ — an Event is anchored on its start date, a class happens *on
          Tuesdays* — so the fields differ; the control, its labels and its
          ordering do not. That is what makes the two screens feel like one
          product rather than two. */}
      <SchedulingTimes startTime={start} endTime={end} onStart={setStart} onEnd={setEnd} />

      <RecurrenceEditor
        value={{ variant: 'weekday_set', type: recurrence, weekdays }}
        onChange={(next) => {
          setRecurrence(next.type);
          if (next.variant === 'weekday_set') setWeekdays(next.weekdays);
        }}
      />

      {!fixed ? (
        <SelectField
          label={t('admin.schedules.teacher')}
          value={teacherId}
          onChange={setTeacherId}
          options={[
            { value: '', label: t('common.choose') },
            ...teachers.map((x) => ({ value: x.id, label: x.name_arabic })),
          ]}
        />
      ) : null}

      <div className="form__actions">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button disabled={!complete || busy} onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * What the write did to the timetable — shown after every successful save.
 *
 * **`protected_sessions` is the reason this dialog exists.** A write that
 * reported only what it created would tell an administrator the timetable is
 * consistent when part of it deliberately is not: those occurrences hold work
 * whose loss would change historical truth, and every applicable reason is
 * listed because someone deciding whether to override one deserves all of them.
 */
function MaterializationDialog({
  report,
  onClose,
}: {
  report: Materialization | null;
  onClose: () => void;
}): ReactNode {
  return (
    <Dialog open={report !== null} onClose={onClose} title={t('admin.schedules.writeTitle')}>
      {report ? (
        <>
          <p>
            {t('admin.schedules.writeSummary')
              .replace('{created}', String(report.created))
              .replace('{resynced}', String(report.resynced))}
          </p>
          {report.protected_sessions.length > 0 ? (
            <>
              <p className="lede">{t('admin.schedules.protectedLede')}</p>
              <ul>
                {report.protected_sessions.map((p) => (
                  <li key={p.id}>
                    <time dateTime={p.date}>{p.date}</time> — {p.reasons.join('، ')}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

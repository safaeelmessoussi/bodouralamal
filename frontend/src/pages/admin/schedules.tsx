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
// Levels, Subjects, Branches, Groups and Academic Years are no longer fetched
// here: `useScopeOptions` owns that graph for every screen (§4.4b, §4.4c).
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { Button } from '../../components/ui/button.js';
import {
  RecurrenceEditor,
  SchedulingTimes,
} from '../../components/scheduling/recurrence-editor.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { SelectField } from '../../components/ui/field.js';
import { ApiError } from '../../lib/api.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { FormDialog, ListDialog } from '../../components/ui/form-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
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

/**
 * The weekday list when there is one, otherwise the recurrence rule's own name —
 * **in Arabic**.
 *
 * The column rendered `weekdays.join('، ')` straight from the wire, so an
 * Arabic-only interface (§6) showed `monday، wednesday`. The enum values are
 * the contract's vocabulary and are never what a reader sees; the catalog that
 * translates them is the one the recurrence editor's checkboxes already use, so
 * the table and the form now say the same word for the same day.
 */
export function recurrenceLabel(
  schedule: Pick<CourseSchedule, 'weekdays' | 'recurrence'>,
): string {
  return schedule.weekdays.length > 0
    ? schedule.weekdays.map((d) => t(`scheduling.weekday.${d}`)).join('، ')
    : t(`calendar.recurrence.${schedule.recurrence}`);
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
  /** The same graph the form uses, and the same one every other screen uses. */
  const listScope = useScopeOptions({ token: accessToken, fields: LIST_SCOPE });

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listCourseSchedules(accessToken, page, {
        ...(listScope.value.branchId ? { branch_id: listScope.value.branchId } : {}),
        ...(listScope.value.subjectId ? { subject_id: listScope.value.subjectId } : {}),
        ...(listScope.value.academicYearId
          ? { academic_year_id: listScope.value.academicYearId }
          : {}),
      });
      setRows(result.data);
      setTotal(result.meta.total);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [accessToken, page, listScope.value.branchId, listScope.value.subjectId, listScope.value.academicYearId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<CourseSchedule>[] = [
    {
      // **Every other CRUD table in the back office leads with a name**, and
      // this one led with a clock time and then showed a raw UUID for the room.
      // A timetable read as `09:00 · administrative_group · <uuid>` is not a
      // different visual language by choice — it is a table with no subject.
      key: 'subject',
      header: t('admin.schedules.subject'),
      cell: (r) => r.subject_name ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'target',
      header: t('admin.schedules.target'),
      // Whichever of the three the mode names (§4.4c) — *who this class is for*
      // is the second thing a reader wants, and the mode alone does not say it.
      cell: (r) => r.target_name ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'time',
      header: t('admin.schedules.time'),
      // Wall-clock, rendered exactly as the API sends it (TD-11). Reformatting
      // through a Date here is how a 15:00 class becomes 14:00 for a reader in
      // another zone.
      cell: (r) => timeLabel(r),
    },
    {
      key: 'recurrence',
      header: t('admin.schedules.recurrence'),
      secondary: true,
      cell: (r) => recurrenceLabel(r),
    },
    {
      key: 'branch',
      header: t('admin.schedules.branch'),
      secondary: true,
      cell: (r) => r.branch_name ?? <span className="muted">{t('common.notSet')}</span>,
    },
    {
      key: 'room',
      header: t('admin.schedules.room'),
      secondary: true,
      cell: (r) => r.room_name ?? <span className="muted">{t('admin.schedules.noRoom')}</span>,
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
      // **The lede is a layout prop, not a paragraph in the body.** الأنشطة
      // passed it here and الحصص rendered its own `<p className="lede">` after
      // the heading, which put the two pages' first line at different heights.
      lede={t('admin.schedules.lede')}
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('admin.schedules.create')}
        </Button>
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.schedules.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        filtered={listScope.value.branchId !== '' || listScope.value.subjectId !== ''}
        onClearFilters={() => {
          listScope.setMany({ branchId: '', levelId: '', subjectId: '', academicYearId: '' });
          setPage(1);
        }}
        toolbar={
          // الأنشطة has always had a filter row; الحصص had none at all, even
          // though `GET /admin/course-schedules` accepts branch, subject and
          // academic year. The same component renders both.
          <ScopeSelectors scope={listScope} fields={LIST_SCOPE} mode="filter" />
        }
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

      <ListDialog
        open={conflicts !== null}
        title={t('admin.schedules.conflictsTitle')}
        lede={t('admin.schedules.conflictsLede')}
        emptyLabel={t('admin.schedules.conflictsEmpty')}
        items={conflicts}
        itemKey={(c) => `${c.session_id}-${c.kind}-${c.resource_id}`}
        renderItem={(c) => (
          <>
            <time dateTime={c.date}>{c.date}</time> — {t(`admin.schedules.conflictKind_${c.kind}`)}
          </>
        )}
        onClose={() => setConflicts(null)}
      />

      <ListDialog
        open={roster !== null}
        title={t('admin.schedules.rosterTitle')}
        lede={t('admin.schedules.rosterLede')}
        emptyLabel={t('admin.schedules.rosterEmpty')}
        items={roster}
        itemKey={(s) => s.student_id}
        renderItem={(s) => s.name ?? s.student_id}
        onClose={() => setRoster(null)}
      />

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

/**
 * The scope this form selects on.
 *
 * Branch and Level come first because they narrow everything after them — the
 * Groups at that premises, and the Subjects that Level actually teaches.
 */
/** What the LIST filters by — the three the endpoint accepts. Level is carried
 *  because Subject depends on it (§4.4b); it is not sent as a filter. */
const LIST_SCOPE = ['branchId', 'levelId', 'subjectId', 'academicYearId'] as const;

const SCHEDULE_SCOPE = [
  'branchId',
  'levelId',
  'groupId',
  'subjectId',
  'academicYearId',
] as const;

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
  const [teachers, setTeachers] = useState<UserSummary[]>([]);

  /** One graph, shared with the content screen and every filter bar. */
  const scope = useScopeOptions({
    token,
    fields: SCHEDULE_SCOPE,
    defaultCurrentYear: true,
  });
  const { branchId, levelId, subjectId, groupId, academicYearId: yearId } = scope.value;

  const [mode, setMode] = useState<string>('administrative_group');
  /** An existing schedule's target is fixed after creation, whatever kind it is
   *  — including `teaching_group`, which the create form does not offer. */
  const [existingTargetId, setExistingTargetId] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [recurrence, setRecurrence] = useState('weekly');
  const [weekdays, setWeekdays] = useState<string[]>(['monday']);
  // §7: `anchor_date` starts the series and, for a fortnightly rule, decides
  // which fortnight is *on*. The form never asked for it.
  const [startDate, setStartDate] = useState('');
  // R50's `effective_until`, on the contract since R55.
  const [endDate, setEndDate] = useState('');
  const [teacherId, setTeacherId] = useState('');
  /** §4.4c — zero or more, and their reach over students equals the teacher's. */
  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      // **Only what the scope graph does not own.** Levels, Subjects, Branches,
      // Groups and Academic Years all come from `useScopeOptions`; the teacher
      // list is this form's alone.
      setTeachers((await searchUsers(token, { role: 'teacher' })).data);
    })();
  }, [open, token]);

  useEffect(() => {
    if (!schedule) return;
    setMode(schedule.teaching_mode);
    setExistingTargetId(schedule.target_id);
    // Seeded rather than chosen: an edit opens on values the graph must accept
    // as given, and `setMany` writes them without triggering the cascade that
    // choosing a parent does.
    scope.setMany({
      subjectId: schedule.subject_id,
      branchId: schedule.branch_id,
      academicYearId: schedule.academic_year_id,
      ...(schedule.teaching_mode === 'entire_level'
        ? { levelId: schedule.target_id }
        : { groupId: schedule.target_id }),
    });
    setStart(schedule.start_time);
    setEnd(schedule.end_time);
    setRecurrence(schedule.recurrence);
    setWeekdays(schedule.weekdays);
    setStartDate(schedule.anchor_date ?? '');
    setEndDate(schedule.effective_until ?? '');
    setTeacherId(schedule.staff.find((s) => s.position === 'teacher')?.user_id ?? '');
    setAssistantIds(
      schedule.staff.filter((s) => s.position === 'assistant').map((s) => s.user_id),
    );
  }, [schedule]);

  const fixed = schedule !== null;

  /**
   * **The target is one of the scope values, chosen by the mode** (§4.4c) — not
   * a separate list of mixed entity kinds. *Entire level* delivers to the Level
   * already chosen; *administrative group* to the roster at that Level and
   * Branch. `teaching_group` is not offered on creation (it needs a split first)
   * and is preserved unchanged on an existing row.
   */
  const targetId = fixed
    ? existingTargetId
    : mode === 'entire_level'
      ? levelId
      : mode === 'administrative_group'
        ? groupId
        : '';

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
            {
              start_time: start,
              end_time: end,
              recurrence,
              weekdays,
              anchor_date: startDate === '' ? null : startDate,
              effective_until: endDate === '' ? null : endDate,
            },
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
              anchor_date: startDate === '' ? null : startDate,
              effective_until: endDate === '' ? null : endDate,
              // **One primary teacher and any number of assistants** (§4.4c),
              // written as one `staff` array because that is one table with one
              // rule — a parallel "assistants" field would be a second model of
              // the same relationship.
              staff: [
                ...(teacherId
                  ? [{ user_id: teacherId, position: 'teacher' as const }]
                  : []),
                ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
              ],
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
    <FormDialog
      open={open}
      title={t(schedule ? 'admin.schedules.editTitle' : 'admin.schedules.create')}
      wide
      notice={notice}
      busy={busy}
      disabled={!complete}
      onCancel={onCancel}
      onSubmit={() => void submit()}
    >
      {/* **The dependency graph, shared with every other screen.** Branch and
          Level narrow the Groups; the Level decides which Subjects exist at all
          (`LevelSubject`, R43). The server refuses a pair the curriculum does
          not contain — `policies/curriculum.ts`, one rule for scheduling,
          teaching-group splits and content alike — so a form that offered every
          Subject was offering combinations that could only be rejected. */}
      <ScopeSelectors
        scope={scope}
        fields={['branchId', 'levelId']}
        mode="form"
        locked={fixed ? ['branchId', 'levelId'] : []}
      />

      <SelectField
        label={t('admin.schedules.mode')}
        value={mode}
        disabled={fixed}
        onChange={(v: string) => {
          setMode(v);
          // The target belongs to the mode; keeping the old id would submit an
          // entity of the wrong kind.
        }}
        options={MODES.filter((m) => m !== 'teaching_group' || fixed).map((m) => ({
          value: m,
          label: t(`admin.schedules.mode_${m}`),
        }))}
      />

      {/* **The target IS one of the scope values**, chosen by the mode (§4.4c):
          *entire level* delivers to the Level already selected above, so it asks
          nothing further; *administrative group* asks which roster at that
          Level and Branch. Rendering a generic "target" list of mixed entity
          kinds was what let a group from another branch be chosen. */}
      {mode === 'administrative_group' ? (
        <ScopeSelectors
          scope={scope}
          fields={['groupId']}
          mode="form"
          locked={fixed ? ['groupId'] : []}
        />
      ) : null}

      <ScopeSelectors
        scope={scope}
        fields={['subjectId']}
        mode="form"
        locked={fixed ? ['subjectId'] : []}
      />

      <ScopeSelectors
        scope={scope}
        fields={['academicYearId']}
        mode="form"
        locked={fixed ? ['academicYearId'] : []}
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
        value={{ type: recurrence, weekdays, startDate, endDate }}
        // §4.4: the database refuses `none` on a schedule — a non-recurring
        // occurrence is an Event, not a class that happens once.
        allowOnce={false}
        onChange={(next) => {
          setRecurrence(next.type);
          setWeekdays(next.weekdays);
          setStartDate(next.startDate);
          setEndDate(next.endDate);
        }}
      />

      {/* §4.4c — **one primary teacher and zero or more assistants.** Both are
          `CourseScheduleStaff` rows differing only in `position`, and both reach
          the schedule's students identically; what the distinction records is
          which of them the class is *taught by*. Rendered as one selector plus a
          checklist rather than two lists of people, so the asymmetry the model
          states is the asymmetry the form shows. */}
      <SelectField
        label={t('admin.schedules.teacher')}
        value={teacherId}
        onChange={setTeacherId}
        options={[
          { value: '', label: t('common.choose') },
          ...teachers.map((x) => ({ value: x.id, label: x.name_arabic })),
        ]}
      />

      <fieldset className="field">
        <legend className="field__label">{t('admin.schedules.assistants')}</legend>
        <div className="field__choices">
          {teachers
            // The primary teacher is not offered as their own assistant: one
            // person holds one position on one schedule, and the pair would be
            // refused by the server as a duplicate assignment.
            .filter((x) => x.id !== teacherId)
            .map((x) => (
              <label key={x.id} className="field field--choice">
                <input
                  type="checkbox"
                  checked={assistantIds.includes(x.id)}
                  onChange={(e) =>
                    setAssistantIds((current) =>
                      e.target.checked
                        ? [...current, x.id]
                        : current.filter((id) => id !== x.id),
                    )
                  }
                />
                <span>{x.name_arabic}</span>
              </label>
            ))}
        </div>
        <p className="field__hint">{t('admin.schedules.assistantsHint')}</p>
      </fieldset>

    </FormDialog>
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
    <ListDialog
      open={report !== null}
      title={t('admin.schedules.writeTitle')}
      lede={
        report
          ? t('admin.schedules.writeSummary')
              .replace('{created}', String(report.created))
              .replace('{resynced}', String(report.resynced))
          : ''
      }
      // An empty list here is the ordinary, reassuring outcome: nothing was
      // spared because nothing needed sparing.
      emptyLabel={t('admin.schedules.protectedNone')}
      items={report?.protected_sessions ?? null}
      itemKey={(p) => p.id}
      renderItem={(p) => (
        <>
          <time dateTime={p.date}>{p.date}</time> —{' '}
          {/* The reasons were rendered as raw R43.6 codes. They are the
              contract's vocabulary, never what a reader sees — and the sessions
              screen already translates the same set. */}
          {p.reasons.map((c) => t(`admin.sessions.protection.${c}`)).join('، ')}
        </>
      )}
      onClose={onClose}
    />
  );
}

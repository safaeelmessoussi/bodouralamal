import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  deleteCourseSchedule,
  listCourseSchedules,
  readConflicts,
  readScheduleRoster,
  type CourseSchedule,
  type ScheduleConflict,
  type ScheduleRosterEntry,
} from '../../adapters/course-schedules.js';
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
    <AdminLayout title={t('admin.nav.schedules')}>
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

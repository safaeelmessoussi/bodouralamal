import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  listCourseSchedules,
  readScheduleRoster,
  type CourseSchedule,
  type ScheduleRosterEntry,
} from '../../adapters/course-schedules.js';
import {
  DataTable,
  type Column,
  type TableStatus,
  type RowAction,
} from '../../components/ui/data-table.js';
import { Dialog } from '../../components/ui/dialog.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { recurrenceLabel, timeLabel } from '../../components/scheduling/labels.js';

/**
 * `/teacher/schedules` — My Teaching (§14.1, §5.6 line 753).
 *
 * **The same endpoint the back office uses**, not a teacher-shaped copy of it.
 * The Document Owner decided (2026-08-05) that `GET /admin/course-schedules` is
 * role-scoped internally — Super Admin sees everything, a branch Admin sees
 * their branches, a Teacher sees the schedules they staff — because the
 * representation is identical and only the scope differs. `/admin/` is a routing
 * namespace, not an authorization boundary.
 *
 * So this screen shares the adapter **and** the two cell renderers with
 * `/admin/schedules`. What differs is what §14.1 says differs: a teacher reads
 * their schedules and their audience, and **does not create or edit them** — so
 * there is no create button, no edit and no delete here, and the server refuses
 * those verbs regardless.
 */
export function TeacherSchedulesPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<CourseSchedule[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [roster, setRoster] = useState<ScheduleRosterEntry[] | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // No teacher filter is sent: the server resolves scope from the live
      // actor. A client-supplied `teacher_id` would be a scope a caller asked
      // for rather than one they hold.
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
    { key: 'time', header: t('admin.schedules.time'), cell: (r) => timeLabel(r) },
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
      cell: (r) => r.room_id ?? <span className="muted">{t('admin.schedules.noRoom')}</span>,
    },
  ];

  const actions: RowAction<CourseSchedule>[] = [
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
  ];

  return (
    <TeacherLayout title={t('teacher.nav.schedules')} lede={t('teacher.schedules.lede')}>
      <DataTable
        caption={t('teacher.schedules.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        pagination={{ page, pageSize: 25, total, onPage: setPage }}
      />

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
    </TeacherLayout>
  );
}

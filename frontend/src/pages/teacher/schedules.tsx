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
import { Button } from '../../components/ui/button.js';
import { SchedulingDialog } from '../admin/scheduling.js';
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
 * their **Recurring Course Schedules** and their audience and does not create or
 * edit them — there is no create, edit or delete for a class here, and the
 * server refuses those verbs regardless. R71.0 records why that `⊘` is
 * load-bearing: §4.4c derives a Teacher's whole scope *from the schedules they
 * staff*, so creating one would let them widen their own reach.
 *
 * **R72 — Activities are different, and are authored here.** TD-2 has granted
 * *"Schedule/edit Events (own scope; hidden allowed)"* since R43 and the service
 * has enforced it ever since, but **§14.1 gave that capability nowhere to
 * happen** — the same defect R69 found for `مواد المستوى` and R70.1 for grade
 * entry. It reuses `SchedulingDialog` with `types={['activity']}`, because R56
 * already made scheduling one form whose *type is a field*; a second screen
 * would be exactly what R69 spent a revision undoing.
 *
 * **The scope rules are the server's, unchanged.** A Teacher must name
 * Administrative Groups they teach and may not reach a branch, category, level
 * or the Global scope — this screen renders those refusals rather than
 * reimplementing them.
 */
export function TeacherSchedulesPage(): ReactNode {
  const { accessToken } = useSession();
  const [rows, setRows] = useState<CourseSchedule[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [roster, setRoster] = useState<ScheduleRosterEntry[] | null>(null);
  /** R72 — authoring an Activity. `'new'` because a Teacher edits an event from
   *  the calendar, not from this list, which is a Course Schedule list. */
  const [composing, setComposing] = useState(false);

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
    <TeacherLayout
      title={t('teacher.nav.schedules')}
      lede={t('teacher.schedules.lede')}
      actions={
        <Button variant="add" onClick={() => setComposing(true)}>
          {t('teacher.schedules.addActivity')}
        </Button>
      }
    >
      {/* The list below is Course Schedules — read-only (§14.1). The action
          above creates an ACTIVITY, which is the one kind TD-2 grants. */}
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

      {composing ? (
        <SchedulingDialog
          item={null}
          token={accessToken}
          // R72 — the one kind a Teacher may author. The form locks the field
          // rather than offering a selector with a single option.
          types={ACTIVITY_ONLY}
          onCancel={() => setComposing(false)}
          onSaved={() => {
            setComposing(false);
            // The class list is unaffected by an activity, and reloading it
            // would suggest otherwise. The new event appears on the calendar.
          }}
        />
      ) : null}
    </TeacherLayout>
  );
}

/** R72 — TD-2 grants a Teacher exactly this one kind on this screen. */
const ACTIVITY_ONLY = ['activity'] as const;

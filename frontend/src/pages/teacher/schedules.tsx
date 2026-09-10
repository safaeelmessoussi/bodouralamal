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
import { PersonalCalendar } from '../../components/calendar/personal-calendar.js';
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
 * `/admin/schedules`. A teacher reads their **Recurring Course Schedules** and
 * their audience through the same role-scoped read every other caller of this
 * table uses (`readableScope`, `course-schedule.service.ts`).
 *
 * **R72 — Activities are different, and are authored here.** TD-2 has granted
 * *"Schedule/edit Events (own scope; hidden allowed)"* since R43 and the service
 * has enforced it ever since, but **§14.1 gave that capability nowhere to
 * happen** — the same defect R69 found for `مواد المستوى` and R70.1 for grade
 * entry. It reuses `SchedulingDialog`, because R56 already made scheduling one
 * form whose *type is a field*; a second screen would be exactly what R69
 * spent a revision undoing.
 *
 * **§2/Revision 140 — a class joins the grant, closing the circularity R71.0
 * once recorded here in terms.** §4.4c derives a Teacher's whole scope *from
 * the schedules they staff*, so letting her create one with no OTHER anchor
 * would have let her widen her own reach — R71.0's own reasoning, and the
 * reason `class` was excluded from `TEACHER_TYPES` for as long as it was. §2
 * closes it with a DIFFERENT, non-circular anchor: her declared
 * `TeacherCategoryCapability`/`TeacherSubjectCapability` (R114) and her
 * `teacher` `UserBranchRole` — never the schedule she is about to create.
 * `assertTeacherDeclaredCapability`/`assertTeacherEntireLevelOnly`/
 * `assertTeacherSelfStaffed` (`course-schedule.service.ts`) are the server's
 * own statement of the boundary; this screen renders the same narrowing
 * (`ClassSection`'s `staffLocked`, `modes={['entire_level']}`, the
 * `/me/course-schedule-options` read) rather than reimplementing it.
 * **`PATCH /admin/course-schedules/{id}` also now accepts her**, for a class
 * she currently staffs (`assertTeacherCurrentlyStaffs`) — same boundary
 * Session CRUD already uses — but this table offers no edit ACTION for it
 * yet; only creation is wired here. Not a narrower server grant, a smaller
 * first UI slice: her occurrence-level tools (حصص الحلقة → cancel/reschedule
 * one Session) already cover the common case, and a class-level edit action
 * is left for a later pass rather than assumed done because the route
 * accepts it.
 *
 * **The scope rules are the server's, unchanged.** For an activity, a Teacher
 * must name Administrative Groups they teach and may not reach a branch,
 * category, level or the Global scope; for a class, she may not reach a Level
 * or Subject she has not declared, nor a branch outside her own
 * `UserBranchRole` — this screen renders those refusals rather than
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
      /**
       * **حصص الحلقة — the occurrences, at last** (R106.6a).
       *
       * TD-2 has granted a مؤطِّرة *"CRUD Sessions — cancel, reschedule, change
       * room, notes ✔ (only sessions they staff)"* since R43, and
       * `staffsSession` has enforced exactly that ever since. This table listed
       * her classes and offered no way into any of their dates, so the grant
       * had **no reach at all** — rule P, the tenth instance on this project.
       *
       * The destination is the same page the back office uses, in her chrome
       * and with her verbs (R70.1's "one implementation, two ways in").
       */
      label: t('admin.schedules.viewSessions'),
      onSelect: (r) => {
        window.location.href = `/teacher/schedules/${r.id}/sessions`;
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
  ];

  return (
    <TeacherLayout
      title={t('teacher.nav.schedules')}
      lede={t('teacher.schedules.lede')}
      actions={
        <Button variant="add" onClick={() => setComposing(true)}>
          {t('teacher.schedules.addItem')}
        </Button>
      }
    >
      {/**
        * **Her own occurrences, on the shared calendar surface** (merged
        * 2026-08-20).
        *
        * `/teacher/calendar` and `/teacher/schedules` were two menu entries onto
        * the same operational question — *what am I teaching, and when* — so a
        * مؤطرة had to know which of the two held the thing she wanted. They are
        * one page now: this calendar plus the definitions table below it.
        *
        * **The projection is unchanged.** This is the same `PersonalCalendar`
        * the beneficiary's portal renders, reading `/me/calendar` (R82.8), with
        * the مؤطرة's own filter set (R84) — nothing about her scope moved, and
        * the server still decides every option she is offered (rule O).
        */}
      <PersonalCalendar
        token={accessToken}
        fields={['branchId', 'categoryId', 'levelId', 'type', 'subjectId', 'groupId', 'circleId']}
        columns={['kind', 'title', 'date', 'time', 'level', 'subject', 'audience', 'branch', 'room']}
        heading={t('teacher.myCalendar')}
      />

      {/**
        * **Its own section, because in قائمة view it was the page's SECOND
        * anonymous table** (2026-09-05).
        *
        * The calendar above answers *when am I teaching* and, in list view,
        * renders its occurrences as a table inside a titled card. This one
        * answers a different question — *what classes am I responsible for* —
        * and had no card and no heading, so it arrived as a naked table
        * immediately below a nearly identical one. Two tables, one label: the
        * page looked duplicated rather than sectioned.
        *
        * **Both sections are real and neither is redundant.** The rules are not
        * the occurrences they produce, and this list carries the roster action
        * nothing else offers her. What was missing was the sentence that says
        * so, which is why the fix is a heading and a lede rather than a deleted
        * table.
        */}
      <section className="card" aria-labelledby="my-classes-heading">
        <h2 id="my-classes-heading">{t('teacher.schedules.caption')}</h2>
        <p className="lede">{t('teacher.schedules.listLede')}</p>
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
      </section>

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
          /**
           * **Her own classes**, so an exam's Level, Subject, Branch and Year
           * come from a class she teaches rather than from `/admin/levels`,
           * which answers 403 for her. The rows are already on this page.
           */
          teachingContexts={rows
            .filter((r) => r.subject_id !== null && r.academic_year_id !== null)
            .map((r) => ({
              id: r.id,
              title: r.title,
              branchId: r.branch_id,
              levelId: r.level_id ?? '',
              subjectId: r.subject_id ?? '',
              academicYearId: r.academic_year_id ?? '',
              groupId: r.teaching_mode === 'administrative_group' ? r.target_id : null,
            }))}
          // R72/§2 — the kinds a Teacher may author here.
          types={TEACHER_TYPES}
          onCancel={() => setComposing(false)}
          onSaved={() => {
            setComposing(false);
            // **§2 — a new class belongs in the table below**, unlike an
            // activity or an exam, neither of which this list holds. Reloading
            // unconditionally is harmless for those two (it re-fetches the
            // SAME rows) and is what makes a newly self-staffed class appear
            // without a manual refresh.
            void load();
          }}
        />
      ) : null}
    </TeacherLayout>
  );
}

/** R72/§2 — TD-2 grants a Teacher exactly these three kinds on this screen. */
/**
 * **What a مؤطرة may create** (R94, extended by §2/Revision 140).
 *
 * `activity` is TD-2's grant, live since R72. `exam` is TD-2's too — the
 * service has accepted a teacher-authored sitting in her §4.4c scope since R70
 * — and no screen offered it, which is rule P's defect for the ninth time.
 *
 * **`class` joins them under §2, and the earlier absence was deliberate for a
 * reason §2 specifically answers.** R71.0 and R72.1 both recorded it: §4.4c
 * derives a مؤطرة's entire scope *from the schedules she staffs*, so letting
 * her create one with no OTHER anchor would let her widen her own reach —
 * the circularity `course-schedule.service.ts`'s own `assertTeacherDeclared
 * Capability` docstring names in terms. §2 closes it with a DIFFERENT anchor
 * that is not circular: her declared `TeacherCategoryCapability`/
 * `TeacherSubjectCapability` (R114) and her `teacher` `UserBranchRole` —
 * never the schedule she is about to create. `ClassSection` itself narrows
 * further, offered nothing beyond that: `entire_level` mode only, and she is
 * named its teacher structurally rather than offered a choice.
 */
const TEACHER_TYPES = ['activity', 'exam', 'class'] as const;

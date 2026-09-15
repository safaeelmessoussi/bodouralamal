import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listCourseSchedules, type CourseSchedule } from '../../adapters/course-schedules.js';
import { listSchedulingItems, type SchedulingItem } from '../../adapters/scheduling.js';
import { specOfKind } from '../../adapters/scheduling-types.js';
import {
  DataTable,
  type Column,
  type SortState,
  type TableStatus,
  type RowAction,
} from '../../components/ui/data-table.js';
import { TeacherLayout } from '../../components/teacher/teacher-layout.js';
import { Button } from '../../components/ui/button.js';
import { SchedulingDialog } from '../admin/scheduling.js';
import { useSession } from '../../contexts/session.js';
import { PersonalCalendar } from '../../components/calendar/personal-calendar.js';
import { t } from '../../i18n/index.js';
import { patternOf } from '../../components/scheduling/recurrence-editor.js';
import { sortRows } from '../../lib/sort-rows.js';

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
 * Session CRUD already uses. **B1 (Revision 152 §1) wires تعديل onto this
 * table's own قائمة**, the same `SchedulingDialog` in edit mode الجدولة's
 * own list already opens — one row action for all three kinds, since
 * Event `assertMayEdit` and Exam `assertCanManage`/`assertScope` admit her
 * in scope the identical way. **حذف is deliberately absent** (Revision 152
 * §2): every kind's deletion stays server-refused for a Teacher by a
 * separately-ratified decision (class — Revision 140 §2; Event — Revision
 * 43/72, R71.3; Exam — R70.4), so wiring it here would either 403 on every
 * row or silently ask to reverse one of those three boundaries — flagged
 * back to the Document Owner instead.
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
  /** Feeds `teachingContexts` below only — her own classes are rendered by
   *  the catalogue list further down, not this raw read. */
  const [rows, setRows] = useState<CourseSchedule[]>([]);
  /** R72 — authoring an Activity. `'new'` because a Teacher edits an event from
   *  the calendar, not from this list, which is a Course Schedule list. */
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    // No teacher filter is sent: the server resolves scope from the live
    // actor. A client-supplied `teacher_id` would be a scope a caller asked
    // for rather than one they hold.
    const result = await listCourseSchedules(accessToken, 1);
    setRows(result.data);
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * **Owner-reported, 2026-09-15 — تقويمي's قائمة, catalogue-shaped like
   * الجدولة's own, not a month's sessions.**
   *
   * حصصي — the separate "what classes am I responsible for" table this page
   * used to render below the calendar — is retired here. Its two verbs move:
   * «حصص الحلقة» becomes this list's own row action (below, gated by
   * `specOfKind(r.type).hasOccurrences`, exactly as الجدولة's identical
   * action is); **«عرض المستفيدات» has NO replacement here or anywhere else
   * on this list** — الجدولة's own قائمة, the shape this now matches, offers
   * no roster action either (only «حصص الحلقة»/edit/delete). Flagged rather
   * than silently dropped or silently rebuilt to a shape nobody asked for —
   * open for the Document Owner's decision.
   */
  const [catalogItems, setCatalogItems] = useState<SchedulingItem[]>([]);
  const [catalogTruncated, setCatalogTruncated] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<TableStatus>('loading');
  const [catalogSort, setCatalogSort] = useState<SortState | null>(null);
  /**
   * **Owner-reported, 2026-09-15 (B1) — تعديل, reusing الجدولة's own edit
   * dialog and server grant, not a teacher-shaped rebuild.** `PATCH
   * /admin/course-schedules/{id}`, Event `assertMayEdit` and Exam
   * `assertCanManage`/`assertScope` already tolerate a Teacher in her own
   * scope (see this file's own docstring on `PATCH .../course-schedules`);
   * this only wires the SAME `SchedulingDialog` الجدولة's own قائمة already
   * opens in edit mode, rather than duplicating it.
   *
   * **حذف is deliberately NOT added here**, on any of the three kinds —
   * unlike تعديل, it stays server-refused for a Teacher across the board:
   * class deletion is Teacher ⊘ by Revision 140 §2's own text ("deletion is
   * untouched... the ratified grant is creation and operational editing, not
   * every write TD-2's row could theoretically cover"); Event deletion is
   * Admin-only by Revision 43/72 and R71.3 (a `responsible` Teacher's grant
   * was scoped to edit, not delete); Exam deletion is Admin-and-above by
   * R70.4, which states in terms that `Exam` carries no `created_by` so
   * "her own but not another's" cannot be expressed against this schema.
   * Wiring حذف here unmodified would 403 at the server on every row and,
   * worse, invite quietly widening one of these three separately-ratified
   * boundaries instead of asking. Flagged for the Document Owner rather than
   * assumed.
   */
  const [editing, setEditing] = useState<SchedulingItem | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogStatus('loading');
    try {
      const result = await listSchedulingItems(accessToken);
      setCatalogItems(result.items);
      setCatalogTruncated(result.truncated);
      setCatalogStatus('ready');
    } catch {
      setCatalogStatus('error');
    }
  }, [accessToken]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const catalogColumns: Column<SchedulingItem>[] = [
    {
      key: 'type',
      sortKey: 'type',
      header: t('scheduling.itemType'),
      cell: (r) => <span className={`badge badge--${r.type}`}>{t(`scheduling.type.${r.type}`)}</span>,
    },
    {
      key: 'title',
      sortKey: 'title',
      header: t('scheduling.title'),
      cell: (r) =>
        r.title.trim() !== '' ? r.title : <span className="muted">{t('scheduling.untitled')}</span>,
    },
    {
      key: 'audience',
      header: t('admin.schedules.target'),
      cell: (r) => r.audienceLabel ?? <span className="muted">—</span>,
    },
    {
      key: 'date',
      sortKey: 'when',
      header: t('admin.schedules.date'),
      cell: (r) => r.startDate ?? <span className="muted">—</span>,
    },
    {
      key: 'when',
      header: t('admin.schedules.time'),
      cell: (r) =>
        r.startTime && r.endTime ? (
          `${r.startTime} — ${r.endTime}`
        ) : (
          <span className="muted">{t('scheduling.allDay')}</span>
        ),
    },
    {
      key: 'subject',
      header: t('admin.schedules.subject'),
      cell: (r) => r.subjectName ?? <span className="muted">—</span>,
    },
    {
      key: 'recurrence',
      header: t('scheduling.recurrence'),
      secondary: true,
      cell: (r) => t(`scheduling.pattern.${patternOf({ type: r.recurrence, weekdays: r.weekdays })}`),
    },
    {
      key: 'branch',
      sortKey: 'branch',
      header: t('admin.schedules.branch'),
      secondary: true,
      cell: (r) => r.branchName ?? <span className="muted">—</span>,
    },
  ];

  const catalogActions: RowAction<SchedulingItem>[] = [
    {
      /**
       * **حصص الحلقة — the occurrences** (R106.6a), carried over from the
       * retired حصصي table rather than dropped with it. TD-2 has granted a
       * مؤطِّرة *"CRUD Sessions — cancel, reschedule, change room, notes ✔
       * (only sessions they staff)"* since R43; this is her way in.
       */
      label: t('admin.schedules.viewSessions'),
      onSelect: (r) => {
        window.location.href = `/teacher/schedules/${r.id}/sessions`;
      },
      // Only a class has occurrences to open (§4.4) — same gate الجدولة's
      // identical action uses.
      available: (r) => specOfKind(r.type).hasOccurrences,
    },
    {
      // B1 — same action, same dialog, as الجدولة's own قائمة; the server
      // already scopes what a Teacher may actually save (see the state
      // declaration above for why حذف has no matching entry here).
      label: t('common.edit'),
      onSelect: (r) => setEditing(r),
    },
  ];

  const teachingContexts = rows
    .filter((r) => r.subject_id !== null && r.academic_year_id !== null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      branchId: r.branch_id,
      levelId: r.level_id ?? '',
      subjectId: r.subject_id ?? '',
      academicYearId: r.academic_year_id ?? '',
      groupId: r.teaching_mode === 'administrative_group' ? r.target_id : null,
    }));

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
        * **Her own occurrences AND her own catalogue, on the shared calendar
        * surface** (merged 2026-08-20; قائمة reworked Owner-reported,
        * 2026-09-15).
        *
        * `/teacher/calendar` and `/teacher/schedules` were two menu entries onto
        * the same operational question — *what am I teaching, and when* — so a
        * مؤطرة had to know which of the two held the thing she wanted. They are
        * one page now.
        *
        * **تقويم stays the shared occurrence projection.** This is the same
        * `PersonalCalendar` the beneficiary's portal renders, reading
        * `/me/calendar` (R82.8), with the مؤطرة's own filter set (R84) —
        * nothing about her scope moved, and the server still decides every
        * option she is offered (rule O).
        *
        * **قائمة is not that any more.** The separate «حصصي» table this page
        * used to render below the calendar answered *what classes am I
        * responsible for* with a month-blind read of its own; قائمة now
        * answers the same question, on the SAME data source الجدولة's own
        * قائمة already reads (`listSchedulingItems` — every scoped
        * Class/Event/Exam definition, never a dated occurrence), via
        * `catalogList`.
        */}
      <PersonalCalendar
        token={accessToken}
        fields={['branchId', 'categoryId', 'levelId', 'type', 'subjectId', 'groupId', 'circleId']}
        columns={['kind', 'title', 'date', 'time', 'level', 'subject', 'audience', 'branch', 'room']}
        heading={t('teacher.myCalendar')}
        catalogList={
          <>
            <DataTable
              caption={t('teacher.myCalendar')}
              columns={catalogColumns}
              rows={sortRows(catalogItems, catalogSort, {
                type: (i) => i.type,
                title: (i) => i.title,
                when: (i) => (i.startDate === null ? null : `${i.startDate}T${i.startTime ?? '00:00'}`),
                branch: (i) => i.branchName,
              })}
              sort={catalogSort}
              onSort={setCatalogSort}
              rowKey={(r) => `${r.type}:${r.id}`}
              status={catalogStatus}
              actions={catalogActions}
              onRetry={() => void loadCatalog()}
            />
            {catalogTruncated ? <p className="muted">{t('scheduling.truncated')}</p> : null}
          </>
        }
      />

      {composing ? (
        <SchedulingDialog
          item={null}
          token={accessToken}
          /**
           * **Her own classes**, so an exam's Level, Subject, Branch and Year
           * come from a class she teaches rather than from `/admin/levels`,
           * which answers 403 for her. The rows are already on this page.
           */
          teachingContexts={teachingContexts}
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
            void loadCatalog();
          }}
        />
      ) : null}

      {editing ? (
        <SchedulingDialog
          item={editing}
          token={accessToken}
          teachingContexts={teachingContexts}
          types={TEACHER_TYPES}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            void loadCatalog();
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

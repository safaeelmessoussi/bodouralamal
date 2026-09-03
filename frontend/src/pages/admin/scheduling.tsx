import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  fetchCalendarBootstrap,
  fetchOccurrences,
  type CalendarBootstrap,
  type HijriDay,
  type Occurrence,
} from '../../adapters/calendar.js';
import { listRooms } from '../../adapters/branches-admin.js';
import {
  listEventScopeOptions,
  listEventStaffOptions,
  notifyEventChange,
} from '../../adapters/events.js';
import { AVAILABLE_TYPES, specOfKind } from '../../adapters/scheduling-types.js';
import {
  listSchedulingTypes,
  type SchedulingTypeRow,
} from '../../adapters/scheduling-catalogue.js';
import type { AttendanceMarking } from '../../adapters/attendance.js';
import {
  deleteSchedulingItem,
  listSchedulingItems,
  saveSchedulingItem,
  weekdaysForClass,
  type SavedSchedulingItem,
  type SchedulingItem,
  type SchedulingType,
} from '../../adapters/scheduling.js';
import { searchDirectory, type DirectoryEntry } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { CalendarGrid } from '../../components/calendar/calendar-grid.js';
import { CalendarHeader } from '../../components/calendar/calendar-header.js';
import { DayEventsDialog } from '../../components/calendar/day-events-dialog.js';
import { EventDetailsDialog } from '../../components/calendar/event-details-dialog.js';
import {
  ActivitySection,
  HOLIDAY_SCOPE_KINDS,
  ClassSection,
  TEACHER_SCOPE_KINDS,
} from '../../components/scheduling/class-section.js';
import type {
  DeliveryMode,
  OnlineMediaMode,
} from '../../components/scheduling/delivery.js';
import { ExamSection, examStaffOf } from '../../components/scheduling/exam-section.js';
import { SchedulingForm } from '../../components/scheduling/scheduling-form.js';
import { patternOf, type RecurrenceValue } from '../../components/scheduling/recurrence-editor.js';
import { CalendarFilters } from '../../components/calendar/calendar-filters.js';
import {
  useCalendarFilters,
  type CalendarFilters as CalendarFilterState,
} from '../../hooks/use-calendar-filters.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  type Column,
  DataTable,
  type RowAction,
  type SortState,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { isDirty } from '../../lib/form-dirty.js';
import {
  periodEndsBeforeItStarts,
  periodOutsideSchedule,
} from '../../lib/staffing-period.js';
import type { StaffingPeriod } from '../../components/scheduling/staffing-periods.js';
import { SelectField } from '../../components/ui/field.js';
import { useTeachingCandidates } from '../../hooks/use-teaching-candidates.js';
import { t } from '../../i18n/index.js';
import { sortRows } from '../../lib/sort-rows.js';
import { ApiError } from '../../lib/api.js';
import { Feedback } from '../../components/ui/feedback.js';

/**
 * `/admin/scheduling` — **الجدولة, the single scheduling entry point**
 * (SRS Revision 56).
 *
 * ## What R56 decided
 *
 * An administrator schedules *something* and picks its kind on the form. They no
 * longer have to know, before clicking anything, whether the thing they want is
 * stored as an `Event` or a `RecurringCourseSchedule` — a question about the
 * platform's internals, asked at the worst possible moment.
 *
 * **The models are not merged** (§20 rule 22, R51): Events are computed on read
 * while Sessions are materialized as rows (TD-4.6c), which is what lets §4.4
 * compute conflicts against real occurrences and lets R50 split a schedule. The
 * divergence lives in `adapters/scheduling.ts` and nowhere else.
 *
 * ## Two views of one thing
 *
 * * **List** — the *definitions*. One weekly class is **one row**, not forty,
 *   because that is the thing an administrator created and the thing edit and
 *   delete act on.
 * * **Calendar** — the *occurrences*, from `GET /calendar`, which has always
 *   merged both kinds. The same grid the public calendar renders.
 *
 * **That distinction is the substantive one.** The two former pages listed
 * *rules* and *expanded occurrences* respectively — not two styles of one
 * screen, but two different questions, which is why no amount of restyling ever
 * made them feel alike.
 *
 * The view is a query parameter rather than a second navigation node, the
 * pattern §5.2's library already uses: a new path segment would be a node §14.1
 * does not list (§20 rule 16).
 */
type View = 'list' | 'calendar';

const MODES = ['administrative_group', 'entire_level'] as const;
/** R91 — the three interval refusals, each with its own sentence. */
const STAFFING_REFUSALS: Record<string, string> = {
  OVERLAPPING_MAIN_TEACHER: 'admin.schedules.overlappingMain',
  OVERLAPPING_ASSIGNMENT: 'admin.schedules.overlappingAssignment',
  STAFF_PERIOD_OUTSIDE_SCHEDULE: 'admin.schedules.staffPeriodOutside',
};

const SCOPE_FIELDS = ['branchId', 'levelId', 'groupId', 'subjectId', 'academicYearId'] as const;
/** What the LIST filters by. A module constant like every other caller's —
 *  the hook no longer depends on identity, but a stable list is still the
 *  clearer way to say "these fields, always". */
/**
 * What `useScopeOptions` loads **for the filter row's options** — no academic
 * year, which R84 removed from calendar filtering. It stays in `SCOPE_FIELDS`
 * above, because the create/edit FORM genuinely requires one (§4.4).
 */
const LIST_SCOPE = ['branchId', 'categoryId', 'levelId', 'subjectId', 'groupId'] as const;

/**
 * The fields the **shared** calendar filters own here — every one of which
 * narrows both قائمة and تقويم (2026-08-19).
 *
 * Category is deliberately absent: the back office filters by Branch and Level
 * directly, and a Category control would narrow the grid while leaving the
 * definition list untouched — a filter that means different things in the two
 * views is the defect this set exists to end.
 */
const CALENDAR_FILTER_FIELDS = [
  'branchId',
  'categoryId',
  'levelId',
  'type',
  'subjectId',
  'groupId',
  'circleId',
] as const;

/**
 * **Nothing stays behind any more** (R84).
 *
 * `LIST_SCOPE_EXTRA` held Subject and Academic Year: Subject has joined the
 * shared set, and **السنة الدراسية is removed from calendar filtering
 * entirely** on the Owner's decision — it narrowed definitions and meant
 * nothing on a month of occurrences, which is precisely the kind of asymmetry
 * that made the two views feel like different screens.
 */

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * **`مرة واحدة` is the creation default for every kind** (Owner, 2026-09-02).
 *
 * It used to be `weekly` for a class or a sitting, so the commonest single
 * booking arrived pre-set to repeat and had to be corrected — the wrong default
 * in the direction that creates data nobody asked for.
 *
 * **This is a creation default only.** An existing item answers with its own
 * stored `recurrence`, and the previous kind-based fallback is retained for the
 * edit path so a stored item with no recurrence resolves exactly as it did
 * before. Nothing about editing changes.
 *
 * Defined once because the form state and its pristine baseline both need it,
 * and a default that disagrees with its own baseline reports the form dirty on
 * open (rule AY.1).
 */
function initialRecurrenceType(
  item: SchedulingItem | null,
  kind: SchedulingType,
): RecurrenceValue['type'] {
  if (item !== null) {
    return item.recurrence ?? (item.type === 'activity' || item.type === 'holiday' ? 'none' : 'weekly');
  }
  /**
   * **Only where `مرة واحدة` is actually offered.**
   *
   * `allowsOnce` is `false` for a class, and not as a UI preference: *"the
   * database refuses `none` on a schedule — a non-recurring occurrence is an
   * Event, not a class that happens once"*. Defaulting to it there put the form
   * state out of step with its own control, which rendered `يومياً` while the
   * state said `none` — a mismatch that would have reached the server as a
   * value it refuses.
   *
   * So the creation default is `once` for every kind that can BE once, and the
   * previous `weekly` for the one that cannot.
   */
  return specOfKind(kind).allowsOnce ? 'none' : 'weekly';
}

export function SchedulingPage(): ReactNode {
  const { accessToken } = useSession();
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'calendar' ? 'calendar' : 'list',
  );

  /**
   * **One filter state, above both views** (2026-08-19).
   *
   * The defect: قائمة applied branch, subject, year and type while تقويم called
   * `GET /calendar` with a date range and **nothing else**, so switching view
   * silently changed the dataset. Each view owned its own state, which is why
   * *the filters* were two things that merely looked alike.
   *
   * The two views read genuinely different sources — the list shows the
   * **definitions** (a recurring schedule, an event, an exam) and the grid shows
   * the **occurrences** they produce — so the shared thing is the filter VALUES,
   * not the rows. Held here, in the URL, so the switch changes presentation only
   * and cannot reset a selection.
   */
  const filters = useCalendarFilters(CALENDAR_FILTER_FIELDS);


  const [items, setItems] = useState<SchedulingItem[]>([]);
  /**
   * R76 — **client-side, and that is the architecture rather than a shortcut.**
   * `listSchedulingItems` MERGES three sources (classes, events, exams) and
   * already orders the result here; there is no single endpoint to sort. The
   * merge is bounded and the table is not server-paginated, so ordering what
   * the page holds IS ordering the collection.
   */
  const [sort, setSort] = useState<SortState | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * **`?new=1&kind=` opens the create form, prefilled** (2026-08-17).
   *
   * `نقاط الامتحانات` does not own exam creation — an exam is scheduled here,
   * because R56 made this the one node for everything that appears on the
   * calendar — so its primary action links *here* rather than growing a second
   * authoring form. The parameter carries the reader's intent across that
   * hand-off; without it they would arrive on a list and have to find the
   * button and re-choose the kind they had already chosen.
   *
   * It **prefills and does not lock**: the kind stays editable, because arriving
   * with an intent is not the same as being committed to it. Read once, on
   * mount, so a later render cannot reopen a dialog the reader has closed.
   */
  const [editing, setEditing] = useState<SchedulingItem | 'new' | null>(() =>
    new URLSearchParams(window.location.search).get('new') === '1' ? 'new' : null,
  );
  const [initialType] = useState<SchedulingType | null>(() => {
    const kind = new URLSearchParams(window.location.search).get('kind');
    return kind !== null && AVAILABLE_TYPES.includes(kind as SchedulingType)
      ? (kind as SchedulingType)
      : null;
  });
  const [deleting, setDeleting] = useState<SchedulingItem | null>(null);
  /** The saved Event change awaiting the send-or-not decision (R82.5). */
  const [notifying, setNotifying] = useState<{
    id: string;
    change: 'created' | 'rescheduled' | 'cancelled';
  } | null>(null);

  /**
   * **A FILTER, and it must say so** (2026-08-18).
   *
   * This is the defect the `subjectsUnscoped` boolean produced: it was opt-in, so
   * `مكتبة المحتوى` received it and this screen did not — the Subject control
   * rendered enabled and empty, reading «لا مواد مسندة إلى هذا المستوى» with no
   * Level chosen. `mode` is the same word already passed to `ScopeSelectors`
   * below, so the two cannot disagree, and a guard asserts they do not.
   */
  const listScope = useScopeOptions({
    token: accessToken,
    fields: LIST_SCOPE,
    mode: 'filter',
  });

  /**
   * **The filter row itself, built once and rendered by BOTH views** (R84).
   *
   * It lived inside the list's table toolbar, so switching to تقويم made the
   * whole section vanish while its values survived in the URL — the reader saw
   * an unfiltered-looking grid that was in fact filtered.
   */
  const filterRow = (
    <CalendarFilters
      filters={filters}
      branches={listScope.options.branchId.map((o) => ({ id: o.value, name: o.label }))}
      // The shared row takes the calendar's reference shapes; `useScopeOptions`
      // speaks `{value,label}`, and mapping here keeps ONE loader for the page
      // rather than a second fetch of the same lists.
      categories={listScope.options.categoryId.map((o) => ({
        id: o.value,
        name: o.label,
        display_order: 0,
      }))}
      levels={listScope.options.levelId.map((o) => ({
        id: o.value,
        name: o.label,
        category_id: '',
        display_order: 0,
      }))}
      subjects={listScope.options.subjectId.map((o) => ({ id: o.value, name: o.label }))}
      groups={listScope.options.groupId.map((o) => ({ id: o.value, name: o.label }))}
      types={AVAILABLE_TYPES.map((k) => ({ value: k, label: t(`scheduling.type.${k}`) }))}
    />
  );

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listSchedulingItems(accessToken, {
        // **The SAME state the grid narrows by**, all of it (R84). Nothing is
        // read from a second filter store any more.
        type: (filters.value.type ?? '') as SchedulingType | '',
        ...(filters.value.branchId ? { branchId: filters.value.branchId } : {}),
        ...(filters.value.levelId ? { levelId: filters.value.levelId } : {}),
        ...(filters.value.subjectId ? { subjectId: filters.value.subjectId } : {}),
      });
      setItems(result.items);
      setTruncated(result.truncated);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [
    accessToken,
    filters.value.type,
    filters.value.branchId,
    filters.value.levelId,
    filters.value.subjectId,
  ]);

  useEffect(() => {
    if (view === 'list') void load();
  }, [load, view]);

  const columns: Column<SchedulingItem>[] = [
    {
      key: 'type',
      sortKey: 'type',
      header: t('scheduling.itemType'),
      // The badge carries the same colour the calendar chip does, from the same
      // token — an exam is recognisable at a glance on either surface.
      cell: (r) => <span className={`badge badge--${r.type}`}>{t(`scheduling.type.${r.type}`)}</span>,
    },
    {
      key: 'title',
      sortKey: 'title',
      header: t('scheduling.title'),
      // A class is named by its Subject and an activity by its title; either can
      // be absent, and the fallback is a localized word rather than a blank cell
      // or — worse — an internal value standing in for a name.
      cell: (r) =>
        r.title.trim() !== '' ? (
          r.title
        ) : (
          <span className="muted">{t('scheduling.untitled')}</span>
        ),
    },
    {
      key: 'audience',
      header: t('admin.schedules.target'),
      // An activity has no audience of that kind (§4.4) — absent, not invented.
      cell: (r) => r.audienceLabel ?? <span className="muted">—</span>,
    },
    {
      /**
       * **§8 — the DATE, which this table did not show at all.**
       *
       * It listed the clock window and no day, so a timetable could not answer
       * *when is this*. For a recurring class the anchor is where the series
       * begins; the recurrence column beside it says how it repeats.
       */
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
      // §8 — WHAT is taught, which the title is not: R57 gave a class its own
      // name, so the two are different facts.
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
    {
      // §8 — where in the building, or that there is no building. R97 makes an
      // online occurrence carry no room at all, so the two facts render as one
      // cell rather than a room column that is blank for every online class.
      key: 'venue',
      header: t('admin.schedules.venue'),
      secondary: true,
      cell: (r) =>
        r.ids.deliveryMode === 'online' ? (
          t('delivery.online')
        ) : (
          (r.roomName ?? <span className="muted">—</span>)
        ),
    },
    {
      // §8 — who may see it (R109). A tier nobody can read on the list is a
      // decision an administrator has to open each row to check.
      key: 'visibility',
      header: t('admin.calendar.colVisibility'),
      secondary: true,
      cell: (r) =>
        r.visibility === null ? (
          <span className="muted">—</span>
        ) : (
          t(`calendar.visibility${r.visibility.charAt(0).toUpperCase()}${r.visibility.slice(1)}`)
        ),
    },
    {
      // §8 — how many مؤطِّرات are assigned. `null` is *this kind has no
      // staffing*, which is a different fact from *nobody is assigned*.
      key: 'staff',
      header: t('admin.schedules.staffCount'),
      secondary: true,
      numeric: true,
      cell: (r) =>
        r.staffCount === null ? <span className="muted">—</span> : String(r.staffCount),
    },
  ];

  const actions: RowAction<SchedulingItem>[] = [
    {
      // R50's three scopes live here, and only a class has occurrences to scope.
      label: t('admin.schedules.viewSessions'),
      onSelect: (r) => {
        window.location.href = `/admin/schedules/${r.id}/sessions`;
      },
      // R50's scopes act on materialized rows; a kind whose occurrences are
      // computed on read has nothing to open (§4.4).
      available: (r) => specOfKind(r.type).hasOccurrences,
    },
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const deleted = deleting;
    setBusy(true);
    try {
      await deleteSchedulingItem(deleted, accessToken);
      setDeleting(null);
      await load();
      setNotice(t('common.deleted'));
      // An Event cancellation is its soft deletion (R82). The delete is already
      // committed; this second dialog decides delivery only. Classes and exams
      // keep their own, separate lifecycle paths unchanged.
      if (deleted.type === 'activity' || deleted.type === 'holiday') {
        setNotifying({ id: deleted.id, change: 'cancelled' });
      }
    } catch {
      setNotice(t('common.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.scheduling')}
      lede={t('scheduling.lede')}
      actions={
        <Button variant="add" onClick={() => setEditing('new')}>
          {t('scheduling.create')}
        </Button>
      }
    >
      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      {/* **The shared header, in its no-month form.** The list is a table of
          recurring schedules rather than a month, so the centre and the stepping
          are absent — see `CalendarHeader`. The calendar view renders the same
          component WITH its month, so there is exactly one header on screen
          either way, and only one place that decides where a control sits. */}
      {/* **The list is not month-scoped** (R84): it shows every matching
          definition, so a month title and a السابق/اليوم/التالي would be
          controls that mean nothing. `CalendarHeader` omits both when it is
          given no month — the same shape-follows-data rule R82 established —
          and the FILTER ROW is rendered either way, which is the property that
          had been broken. */}
      {view === 'list' ? (
        <CalendarHeader view={view} onView={setView} filters={filterRow} />
      ) : null}

      {view === 'list' ? (
        <>
          {/* **No `toolbar` prop** — the filter row lives in the shared header
              above, for BOTH views. Passing it to the table as well rendered it
              twice on the list (`cal-header__filters` and `datatable__toolbar`,
              one above the other): R84 moved the row up and this was the half
              that should have moved with it. */}
          <DataTable
            caption={t('admin.nav.scheduling')}
            columns={columns}
            rows={sortRows(items, sort, {
              // **Semantic values, never the rendered Arabic label.** `when`
              // composes date + wall-clock time so two items on one day order
              // by the clock; a null time is an all-day item and sorts by the
              // date alone rather than being treated as absent.
              type: (i) => i.type,
              title: (i) => i.title,
              when: (i) => (i.startDate === null ? null : `${i.startDate}T${i.startTime ?? '00:00'}`),
              branch: (i) => i.branchName,
            })}
            sort={sort}
            onSort={setSort}
            rowKey={(r) => `${r.type}:${r.id}`}
            status={status}
            actions={actions}
            onRetry={() => void load()}
            filtered={filters.active}
            onClearFilters={() => filters.clear()}
          />
          {/* Stated rather than hidden: merging two independently paginated
              sources cannot produce a correct combined page without reading
              both, so the combined view reads one page of each and says so. */}
          {truncated ? <p className="muted">{t('scheduling.truncated')}</p> : null}
        </>
      ) : (
        <CalendarView view={view} onView={setView} filters={filters} filterRow={filterRow} />
      )}

      {editing ? (
        <SchedulingDialog
          item={editing === 'new' ? null : editing}
          {...(editing === 'new' && initialType ? { initialType } : {})}
          token={accessToken}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setNotice(t('common.saved'));
            void load();
            /**
             * **R82.5 — the change is already saved; this only decides who is
             * told.** Offered for an EVENT only: a class occurrence uses its
             * separate R83 confirmation flow, and an exam notifies at
             * publication.
             */
            if (saved.id !== null) {
              setNotifying({
                id: saved.id,
                change: saved.created ? 'created' : 'rescheduled',
              });
            }
          }}
        />
      ) : null}

      {/* **R82.5 — the optional notice.** The change is saved and stays saved
          whichever button is pressed; only delivery is decided here. The shared
          `ConfirmDialog` asks it, so *"are you sure"* and *"shall I tell
          people"* are asked with the same voice (§14.3). */}
      <ConfirmDialog
        open={notifying !== null}
        title={t('scheduling.notify.title')}
        body={t('scheduling.notify.body')}
        details={
          <p className="muted">{t('scheduling.notify.audience')}</p>
        }
        confirmLabel={t('scheduling.notify.send')}
        cancelLabel={t('scheduling.notify.skip')}
        busy={busy}
        onConfirm={() => {
          void (async () => {
            if (!notifying?.id) return;
            setBusy(true);
            try {
              const result = await notifyEventChange(
                notifying.id,
                notifying.change,
                accessToken,
              );
              /**
               * **Zero is an ANSWER, not a quiet success.**
               *
               * «أُرسل الإشعار إلى 0 من المعنيين» reads as *done*, and the case
               * that showed it is ordinary: the only beneficiary enrolled in
               * that Level at that branch was the administrator's own account,
               * and nobody is ever notified of their own act (R78.3). She sent,
               * saw a success message, logged in as herself and found nothing —
               * with the platform never saying that nobody was concerned.
               */
              setNotice(
                result.notified === 0
                  ? t('scheduling.notify.sentNone')
                  : t('scheduling.notify.sent').replace('{n}', String(result.notified)),
              );
              setNotifying(null);
            } catch {
              /**
               * The change is already saved; only the notice failed, and saying
               * so precisely matters — a generic failure here would read as
               * though the event had not been created.
               *
               * **The dialog stays open** (2026-08-20), for the same reason as
               * the occurrence's: «يمكنك المحاولة لاحقاً» named a retry that did
               * not exist, and the only way back was to edit the event again.
               * Pressing «إرسال الإشعار» again is safe — the
               * `(user, event, type)` unique index makes a repeat the same rows.
               */
              setNotice(t('scheduling.notify.failed'));
            } finally {
              setBusy(false);
            }
          })();
        }}
        onCancel={() => {
          // **Nothing is called.** Declining is not a request that sends zero
          // notifications; it is the absence of the request.
          setNotifying(null);
          setNotice(t('scheduling.notify.skipped'));
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('scheduling.deleteTitle')}
        body={t('scheduling.deleteBody').replace('{title}', deleting?.title ?? '')}
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
 * The **occurrence** view — the same grid the public calendar renders, on the
 * same `GET /calendar` read, which has always merged Sessions and Events.
 *
 * Reused rather than rebuilt: a second month grid would be a second answer to
 * *what does a month look like*, and the two would drift.
 */
function CalendarView({
  view,
  onView,
  filters,
  filterRow,
}: {
  view: View;
  onView: (view: View) => void;
  /** The page's filters — **not this view's**. See `useCalendarFilters`. */
  filters: CalendarFilterState;
  /** The rendered row, so both views show the identical controls (R84). */
  filterRow: ReactNode;
}): ReactNode {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [bootstrap, setBootstrap] = useState<CalendarBootstrap | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  /** The occurrence whose details are open — the shared dialog, not a fork. */
  const [openEvent, setOpenEvent] = useState<Occurrence | null>(null);

  useEffect(() => {
    const from = startOfMonth(month);
    const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    // `GET /calendar` is public with optional authentication: the credential
    // travels on the request and REORDERS nothing here, it only widens the tier
    // a staff caller sees (§5.2). The adapter reads the session itself.
    // **The filters the list uses, applied here too** — the defect this fixes
    // was that this call took a date range and nothing else.
    void fetchOccurrences({
      from: iso(from),
      to: iso(to),
      ...(filters.value.branchId ? { branchId: filters.value.branchId } : {}),
      ...(filters.value.categoryId ? { categoryId: filters.value.categoryId } : {}),
      ...(filters.value.levelId ? { levelId: filters.value.levelId } : {}),
      ...(filters.value.subjectId ? { subjectId: filters.value.subjectId } : {}),
      ...(filters.value.groupId ? { groupId: filters.value.groupId } : {}),
      ...(filters.value.circleId ? { circleId: filters.value.circleId } : {}),
      ...(filters.value.type ? { kind: filters.value.type } : {}),
    })
      .then((r) => setOccurrences(r.occurrences))
      .catch(() => setOccurrences([]));
    // **The Hijri overlay comes from the same bootstrap the public calendar
    // reads** (R31–32): recorded Ministry announcements, never a computation.
    // This view passed an empty map, so the back office was the one calendar in
    // the platform showing no Hijri date at all — a regression, not a decision.
    void fetchCalendarBootstrap({ from: iso(from), to: iso(to) })
      .then(setBootstrap)
      .catch(() => setBootstrap(null));
  }, [
    month,
    filters.value.branchId,
    filters.value.categoryId,
    filters.value.levelId,
    filters.value.subjectId,
    filters.value.groupId,
    filters.value.circleId,
    filters.value.type,
  ]);

  /** Recorded official Hijri days, keyed for O(1) lookup per cell. */
  const hijriByDate = useMemo(() => {
    const map = new Map<string, HijriDay>();
    for (const day of bootstrap?.hijri.days ?? []) map.set(day.date, day);
    return map;
  }, [bootstrap]);

  const byDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      map.set(o.date, [...(map.get(o.date) ?? []), o]);
    }
    return map;
  }, [occurrences]);

  return (
    <div aria-live="polite">
      {/* **The same header component the public calendar uses**, rather than the
          same three atoms arranged differently — which is what this view had, in
          the FILTERS container, with its view switch elsewhere on the page. */}
      <CalendarHeader
        view={view}
        onView={onView}
        gregorianMonths={bootstrap?.gregorian_months ?? []}
        hijriMonths={bootstrap?.hijri.months ?? []}
        month={month}
        onPrevious={() => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
        onToday={() => setMonth(startOfMonth(today))}
        onNext={() => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
        filters={filterRow}
      />

      <CalendarGrid
        month={month}
        byDate={byDate}
        hijriByDate={hijriByDate}
        today={today}
        selected={openDay}
        onSelect={setOpenDay}
        onOpenEvent={setOpenEvent}
      />

      <DayEventsDialog
        date={openDay}
        hijri={null}
        occurrences={openDay ? (byDate.get(iso(openDay)) ?? []) : []}
        onClose={() => setOpenDay(null)}
        onOpenEvent={setOpenEvent}
      />

      {/**
        * **The same shared dialog the other three calendars open**
        * (2026-08-20). Clicking an occurrence in the back office did nothing:
        * `onOpenEvent` was `() => undefined` here and on the personal
        * calendars, so the component existed and one surface out of four used
        * it. The difference between surfaces is the caller's own token, which
        * is what decides the tier of the session content it reads.
        */}
      <EventDetailsDialog
        occurrence={openEvent}
        branchNames={new Map()}
        onClose={() => setOpenEvent(null)}
      />
    </div>
  );
}

/**
 * One dialog, one form, every type.
 *
 * The shell owns the shared fields; the type-specific section is composed in.
 * Adding Exams (§4.6, M5) is a third `section` and a third arm in the adapter's
 * router — nothing in this file's structure moves.
 */
/**
 * **Exported for the teacher portal (R72).** `/teacher/schedules` renders this
 * same dialog with `types={['activity']}` — TD-2 grants a Teacher event
 * authoring and nothing else on this screen, and R56 already made scheduling
 * one form whose *type is a field*, so the teacher view offers the one kind
 * they may author rather than becoming a second implementation.
 *
 * Everything else is unchanged and deliberately so: the scope rules, the
 * refusals and the R71 staff picker are the server's and the shared
 * components', not this dialog's.
 */
export function SchedulingDialog({
  item,
  token,
  onCancel,
  onSaved,
  types = AVAILABLE_TYPES,
  teachingContexts,
  initialType,
}: {
  item: SchedulingItem | null;
  token: string | null;
  onCancel: () => void;
  onSaved: (saved: SavedSchedulingItem) => void;
  /** R72 — the kinds this caller may create. One kind locks the field. */
  types?: readonly SchedulingType[];
  /**
   * **Her own classes, when the caller cannot read the curriculum** (R94).
   *
   * `useScopeOptions` builds the Branch → Level → Subject → Year chain from
   * `/admin/levels` and `/admin/academic-years`, which answer **403** for a
   * مؤطرة. An exam belongs to a Level, Subject, Branch and Year she teaches —
   * which is exactly what one of her own schedules already states — so she
   * picks the class instead of rebuilding its scope from reads she may not
   * make. Absent for an Admin, whose chain works.
   */
  teachingContexts?: {
    id: string;
    title: string;
    branchId: string;
    levelId: string;
    subjectId: string;
    academicYearId: string;
    groupId: string | null;
  }[];
  /**
   * The kind a *creating* caller arrived intending, from `?kind=`.
   *
   * **Prefill, not a lock** — `types` is what constrains what may be created,
   * and conflating "I came here to book an exam" with "I may only book exams"
   * would turn a convenience into an authorization statement. Ignored while
   * editing, where the kind is the item's own and is not a choice at all.
   */
  initialType?: SchedulingType;
}): ReactNode {
  const editing = item !== null;
  const [type, setType] = useState<SchedulingType>(
    item?.type ?? (initialType && types.includes(initialType) ? initialType : types[0] ?? 'class'),
  );
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [allDay, setAllDay] = useState(item ? item.startTime === null : false);
  const [startTime, setStartTime] = useState(item?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(item?.endTime ?? '10:00');
  const [endDate, setEndDate] = useState(item?.endDate ?? '');
  const [recurrence, setRecurrence] = useState<RecurrenceValue>({
    type: initialRecurrenceType(item, type),
    weekdays: item?.weekdays ?? [],
    startDate: item?.startDate ?? '',
    endDate: item?.repeatUntil ?? '',
  });

  /**
   * **The creation default follows the kind, because the kind is chosen after
   * the form opens** (Owner, 2026-09-02).
   *
   * The state is seeded once, from whichever kind the dialog opened on, so
   * switching to حفل afterwards left the previous kind's default in place and
   * the new item was still pre-set to repeat.
   *
   * It also closes a latent fault in the other direction. `once` is offered
   * only where `allowsOnce` is true — the database refuses that recurrence on a
   * schedule — so switching activity → class used to leave the state on a value
   * the control no longer displayed and the server would reject.
   *
   * **Creation only.** An existing item answers with its stored recurrence and
   * is never rewritten by opening its form; `item` is fixed for the life of the
   * dialog, so this cannot fire for an edit.
   */
  useEffect(() => {
    if (item !== null) return;
    setRecurrence((current) => {
      const next = initialRecurrenceType(null, type);
      return current.type === next ? current : { ...current, type: next, weekdays: [] };
    });
  }, [item, type]);

  /**
   * **The mode is the ROW's, not a default** (2026-08-18).
   *
   * It was `useState('administrative_group')` for every class, edit included,
   * and the mode select is `disabled` while editing — so an `entire_level`
   * class opened showing the wrong mode with no way to correct it. Two
   * consequences, and the second is the serious one:
   *
   * * `targetId` read `groupId` for a class whose target is a Level, so Save
   *   refused with *«اختاري الحلقة المعنية»* against a field the form does not
   *   let you fill;
   * * `teachingMode: mode` is **sent on save**, so saving an unrelated edit —
   *   a new end date, say — would have rewritten that class's audience.
   */
  const [mode, setMode] = useState<string>(item?.ids.teachingMode ?? 'entire_level');
  const [roomId, setRoomId] = useState(item?.ids.roomId ?? '');
  /**
   * **R97 — طريقة الحضور**, defaulting to حضوري: that is the column's default,
   * what every class scheduled before this revision was, and what an
   * administrator opening the form is most often about to schedule.
   */
  const [delivery, setDelivery] = useState<DeliveryMode>(
    item?.ids.deliveryMode === 'online' ? 'online' : 'in_person',
  );
  const [mediaMode, setMediaMode] = useState<OnlineMediaMode>(
    item?.ids.onlineMediaMode === 'audio_only' ? 'audio_only' : 'audio_video',
  );
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number | null }[]>([]);
  // `RoomDto` publishes no `capacity` — BR-23 makes it informational and it is
  // enforced nowhere, so putting it on this wire is a further contract change
  // and is recorded as such rather than smuggled in here.
  const [teachers, setTeachers] = useState<DirectoryEntry[]>([]);
  /**
   * **R91 — staffing is a list of dated assignments**, for a class.
   *
   * `teacherId` + `assistantIds` could not express the association's own cases:
   * a temporary replacement gives Safa two periods on one schedule, and a flat
   * lead selector has one slot. The exam and the celebration keep the flat pair
   * below, because they staff a single dated thing.
   */
  const [staffing, setStaffing] = useState<StaffingPeriod[]>(() =>
    (item?.ids.staff ?? []).map((x) => ({
      user_id: x.user_id,
      position: (x.position === 'teacher' ? 'teacher' : 'assistant') as 'teacher' | 'assistant',
      effective_from: x.effective_from ?? '',
      effective_until: x.effective_until ?? '',
    })),
  );
  /**
   * The exam sitting's and the celebration's flat staffing, which R91 did not
   * change: they staff one dated thing, so a period would be a field with one
   * possible value. **A class no longer uses these** — see `staffing` above.
   */
  const [teacherId] = useState(
    item?.ids.staff.find((x) => x.position === 'teacher')?.user_id ?? '',
  );
  const [assistantIds, setAssistantIds] = useState<string[]>(
    (item?.ids.staff ?? []).filter((x) => x.position === 'assistant').map((x) => x.user_id),
  );
  // An exam already saved is physical: `online` cannot be stored (§4.6, R58).
  const [examMode, setExamMode] = useState<'physical' | 'online'>('physical');
  /** R81 — the exam's own maximum grade. A string while it is being typed; the
   *  form has no default to offer, because there is no platform scale left. */
  const [examMaxGrade, setExamMaxGrade] = useState('');
  /** R94 — which of her classes this sitting belongs to. */
  const [examContextId, setExamContextId] = useState('');
  const [supervisorId, setSupervisorId] = useState(
    item?.ids.staff.find((x) => x.position === 'supervisor')?.user_id ?? '',
  );
  // R71 — who answers for an event. Prefilled from the item's own rows, so
  // editing a celebration shows the مؤطرة already responsible for it.
  // R60 — the ACTIVE role, so a Super Admin working as مؤطِّرة is not offered a
  // control the server will refuse. R71.4 keeps event staffing with Admins.
  const { activeRoles } = useActiveRole();
  const canAssignStaff = activeRoles.some((r) => r === 'admin' || r === 'super_admin');
  // **Her own identity**, so a مؤطرة's event carries her as responsible without
  // a control that could name anybody else. The server refuses any other name
  // regardless (`RESPONSIBLE_MUST_BE_SELF`) — this is the honest payload, not
  // the enforcement.
  const { me } = useSession();
  /** R93 — her own groups, because the admin scope chain answers 403 for her. */
  const [teacherScopes, setTeacherScopes] = useState<{ id: string; name: string }[]>([]);
  /** Whether she has ANY scope to choose — *nothing to choose* is a different
   *  answer from *choose one*, and the form says which. */
  const scopeOptionsEmpty = !canAssignStaff && teacherScopes.length === 0;

  const [responsibleId, setResponsibleId] = useState(
    item?.ids.staff.find((x) => x.position === 'responsible')?.user_id ?? '',
  );
  /**
   * **Hydrated from the stored row on Edit** (NEW B §A).
   *
   * This was `useState('public')` for edit as well as create — and the pristine
   * baseline below hardcoded `'public'` to match it. Three things then combined
   * into a widening nobody chose: the form never showed the real tier, `dirty`
   * stayed false because both halves agreed, and the save payload sends
   * `visibility` on update as well as create. So opening a **private** or
   * **hidden** نشاط, changing its title, and saving reset it to عام, silently,
   * with no prompt from the unsaved-changes guard.
   *
   * `'public'` remains the CREATE default (Owner decision 00) — which is
   * precisely what made the bug invisible: the wrong value and the intended
   * default are the same string.
   */
  const [visibility, setVisibility] = useState(item?.visibility ?? 'public');
  /**
   * **R110 — the catalogue row this activity is** (NEW H).
   *
   * Hydrated from the row, exactly as `visibility` now is: a state initialiser
   * that ignored the record and a pristine baseline that agreed with it is what
   * made §A's silent widening invisible. `null` is a real state — an activity
   * created before the catalogue existed recorded no type.
   */
  const [schedulingTypeId, setSchedulingTypeId] = useState<string | null>(
    item?.ids.schedulingTypeId ?? null,
  );
  const [catalogue, setCatalogue] = useState<SchedulingTypeRow[]>([]);
  // R72 — a Teacher may scope an event to their own groups and nothing else
  // (TD-2, §4.9), so `global` would be a default the server refuses.
  /**
   * **R123 — who may record presence at this item's occurrences.**
   *
   * `staff_only` is the initial value on a create, which is the safe direction:
   * a setting nobody chose must never be the permissive one.
   */
  const [attendanceMarking, setAttendanceMarking] = useState<AttendanceMarking>(
    item?.attendanceMarking ?? 'staff_only',
  );
  const [scopeKind, setScopeKind] = useState(canAssignStaff ? 'global' : 'group');
  const [scopeId, setScopeId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * **Unsaved work here is the most expensive on the platform**, which is why the
   * snapshot is exhaustive rather than a representative sample: this form carries
   * eighteen fields including a recurrence pattern and two staff lists, and a
   * `dirty` that missed one would silently discard exactly the change a reader
   * had just made.
   *
   * **No timing hazard.** Every field above is initialised from `item` in its own
   * `useState`, so the pristine side is the *same expressions*. This form has no
   * reset effect, unlike the dialogs whose fields are written after first render —
   * which is the reason `isDirty` takes both sides explicitly rather than
   * capturing a baseline (see `lib/form-dirty.ts`).
   *
   * The staff lists are sorted on both sides: a set of assistants is unordered,
   * so a reordering is not a change.
   */
  const pristine = {
    type: item?.type ?? (initialType && types.includes(initialType) ? initialType : types[0] ?? 'class'),
    title: item?.title ?? '',
    description: item?.description ?? '',
    allDay: item ? item.startTime === null : false,
    startTime: item?.startTime ?? '09:00',
    endTime: item?.endTime ?? '10:00',
    endDate: item?.endDate ?? '',
    recurrence: {
      type: initialRecurrenceType(item, type),
      weekdays: item?.weekdays ?? [],
      startDate: item?.startDate ?? '',
      endDate: item?.repeatUntil ?? '',
    },
    // Pristine mirrors the state above expression for expression, or `dirty`
    // would report every edited class as changed before it was touched.
    mode: item?.ids.teachingMode ?? 'entire_level',
    roomId: item?.ids.roomId ?? '',
    // R97 — delivery joins the dirty check (rule U): a form holding an unsaved
    // switch to عن بُعد must not close on a stray backdrop click.
    delivery: item?.ids.deliveryMode === 'online' ? 'online' : 'in_person',
    mediaMode: item?.ids.onlineMediaMode === 'audio_only' ? 'audio_only' : 'audio_video',
    teacherId: item?.ids.staff.find((x) => x.position === 'teacher')?.user_id ?? '',
    // **R91 — the dated assignments join the dirty check** (rule U). A form
    // holding an unsaved replacement must not close on a stray click, and
    // `dirty` defaults to false, so a field left out here is silently lost.
    staffing: (item?.ids.staff ?? []).map((x) => ({
      user_id: x.user_id,
      position: x.position,
      effective_from: x.effective_from ?? '',
      effective_until: x.effective_until ?? '',
    })),
    assistantIds: (item?.ids.staff ?? [])
      .filter((x) => x.position === 'assistant')
      .map((x) => x.user_id)
      .sort(),
    examMode: 'physical',
    supervisorId: item?.ids.staff.find((x) => x.position === 'supervisor')?.user_id ?? '',
    responsibleId: item?.ids.staff.find((x) => x.position === 'responsible')?.user_id ?? '',
    // Mirrors the state initialiser exactly — a pristine baseline that
    // disagreed with it is what kept `dirty` false while the value was wrong.
    visibility: item?.visibility ?? 'public',
    // Mirrors the initialiser above — the pair §A proved has to agree.
    schedulingTypeId: item?.ids.schedulingTypeId ?? null,
    scopeKind: canAssignStaff ? 'global' : 'group',
    scopeId: '',
    // Mirrors the initialiser above — a pristine baseline that disagreed with
    // it is what kept `dirty` false while the value was wrong (§A).
    attendanceMarking: item?.attendanceMarking ?? 'staff_only',
  };
  const dirty = isDirty(
    {
      type,
      schedulingTypeId,
      title,
      description,
      allDay,
      startTime,
      endTime,
      endDate,
      recurrence,
      mode,
      roomId,
      delivery,
      mediaMode,
      teacherId,
      staffing,
      assistantIds: [...assistantIds].sort(),
      examMode,
      supervisorId,
      responsibleId,
      visibility,
      scopeKind,
      scopeId,
      attendanceMarking,
    },
    pristine,
  );

  const scope = useScopeOptions({ token, fields: SCOPE_FIELDS, defaultCurrentYear: true });

  /**
   * **Seed the scope from the row being edited.**
   *
   * Not cosmetic: `PATCH /exams` sends the group unconditionally, so a form that
   * opened with an empty group would clear the audience of every exam anybody
   * merely re-titled. The row already carries its ids, so this needs no fetch.
   *
   * Runs once per opened row — the selectors own the value afterwards.
   */
  const seeded = useRef<string | null>(null);
  /**
   * **R110 — the type picker's options come from the server** (NEW H).
   *
   * Readable by anyone who may schedule, a مؤطِّرة included (R93/R94), so this
   * runs for every caller who can open the dialog rather than being gated on a
   * role here — the server decides, and a client-side gate would be a second
   * answer to the same question.
   *
   * A failure leaves the list empty, and `TypePicker` falls back to the entity
   * labels rather than rendering an empty selector: a picker with no options is
   * a form nobody can submit.
   */
  useEffect(() => {
    let live = true;
    void listSchedulingTypes(token)
      .then((rows) => {
        if (live) setCatalogue(rows);
      })
      .catch(() => {
        if (live) setCatalogue([]);
      });
    return () => {
      live = false;
    };
  }, [token]);

  useEffect(() => {
    if (item === null || seeded.current === item.id) return;
    seeded.current = item.id;
    scope.setMany({
      ...(item.ids.branchId !== null ? { branchId: item.ids.branchId } : {}),
      ...(item.ids.levelId !== null ? { levelId: item.ids.levelId } : {}),
      ...(item.ids.groupId !== null ? { groupId: item.ids.groupId } : {}),
      ...(item.ids.subjectId !== null ? { subjectId: item.ids.subjectId } : {}),
      ...(item.ids.academicYearId !== null ? { academicYearId: item.ids.academicYearId } : {}),
    });
  }, [item, scope]);
  /** Everything the interface needs to know about this kind, declared once. */
  const spec = specOfKind(type);

  useEffect(() => {
    /**
     * **Two different questions, asked by whoever may ask them** (R93).
     *
     * `GET /admin/users` answers **403** for a مؤطرة, so this used to leave her
     * staff list empty — and the assistants control on her own event with
     * nothing in it. An Admin still reads the full list, because she also
     * staffs classes from it and needs more than names; a مؤطرة reads the
     * narrow one, which is only *whom may I name here*.
     */
    if (canAssignStaff) {
      void searchDirectory(token, { role: 'teacher' })
        .then((p) => setTeachers(p.data))
        .catch(() => setTeachers([]));
      return;
    }
    void listEventScopeOptions(token)
      .then(setTeacherScopes)
      .catch(() => setTeacherScopes([]));
    void listEventStaffOptions(token)
      .then((rows) =>
        setTeachers(
          rows.map((r) => ({ id: r.id, name_arabic: r.name }) as unknown as DirectoryEntry),
        ),
      )
      .catch(() => setTeachers([]));
  }, [token, canAssignStaff]);

  // Rooms belong to a branch, so the list follows the branch choice — a room at
  // another branch is one the class cannot meet in (§4.4).
  useEffect(() => {
    if (scope.value.branchId === '') {
      setRooms([]);
      return;
    }
    void listRooms(scope.value.branchId, token)
      .then((p) => setRooms(p.data.map((r) => ({ id: r.id, name: r.name, capacity: null }))))
      .catch(() => setRooms([]));
  }, [scope.value.branchId, token]);

  const targetId =
    mode === 'entire_level' ? scope.value.levelId : scope.value.groupId;

  /**
   * **R90 — appraise the مؤطِّرات against the class as it stands on the form.**
   *
   * Only for a class: an exam sitting and a celebration carry no Subject and no
   * curriculum Category, so a teaching profile has nothing to be appraised
   * against and the picker renders unannotated.
   *
   * **The Level, not the target.** A class taught to an Administrative Group
   * still belongs to a Level, and the Level is what carries the Category the
   * profile declares (§4.4b) — so `scope.value.levelId` is passed whichever
   * teaching mode is chosen.
   *
   * `exclude_schedule_id` on an edit, or the schedule's own staffing would be
   * reported as clashing with itself — the commonest false warning there is.
   */
  const appraisal = useTeachingCandidates(
    type === 'class' && startTime !== '' && endTime !== ''
      ? {
          recurrence: recurrence.type,
          weekdays: weekdaysForClass(recurrence.type, recurrence.weekdays, recurrence.startDate),
          startTime,
          endTime,
          deliveryMode: delivery,
          ...(scope.value.subjectId ? { subjectId: scope.value.subjectId } : {}),
          ...(scope.value.levelId ? { levelId: scope.value.levelId } : {}),
          ...(item?.id ? { excludeScheduleId: item.id } : {}),
        }
      : null,
    token,
  );

  /**
   * **What is missing, in the person's words — not a disabled button.**
   *
   * The form used to disable Save until everything was set, which is why it
   * "did nothing": a class needs four scope values chosen in order (branch →
   * level → group → subject), and until the last one landed the button was
   * inert with nothing on screen explaining why. A control that refuses without
   * saying why teaches nothing (§14.4).
   *
   * So Save is always clickable and validation answers **here**, naming the
   * first thing to fix. The order matches the form's own order, so the message
   * points at the next field rather than the last one.
   */
  function validationError(): string | null {
    // R57 — required for every kind, so it is checked before anything specific.
    if (title.trim() === '') return t('scheduling.invalid.title');
    /**
     * **R110 — every schedulable item states which type it is** (Owner,
     * 2026-09-02; activities only before that).
     *
     * A class and a sitting record their catalogue row too now, so the picker
     * offers one for every kind and the answer is required for every kind —
     * otherwise the calendar's النوع filter would have nothing to narrow a
     * class by, which is the capability-with-no-reach shape (rule P).
     *
     * Refusing here names the field instead of surfacing a `400` about a key
     * the reader never saw. Only checked while the catalogue actually loaded:
     * if the read failed the picker fell back to entity labels, and demanding a
     * row nobody was offered would be a gate on the platform's own blindness —
     * the shape R94 already corrected once. **Never on edit**: a row created
     * before the catalogue reached its kind has no type and the picker is
     * locked, so requiring one would make an unrelated edit unsavable.
     */
    if (!editing && catalogue.length > 0 && schedulingTypeId === null) {
      return t('scheduling.invalid.itemType');
    }
    if (recurrence.startDate === '') return t('scheduling.invalid.startDate');
    /**
     * **A staffing period outside the class's life, refused HERE** (2026-08-29).
     *
     * The server refuses it — `STAFF_PERIOD_OUTSIDE_SCHEDULE`, and that stays
     * the authority — but only on Save, and its message names no field. The
     * rows mark themselves as they are typed; this is the same rule at the
     * submit boundary, so an invalid combination cannot survive a schedule-date
     * edit that made it invalid without anyone touching the assignment.
     *
     * `rangesOverlap` is the one client-side statement of the rule, shared with
     * the rows — not a second copy that could disagree with the marking the
     * reader is looking at.
     */
    const outside = staffing
      .filter((row) => row.user_id !== '')
      .some((row) =>
        periodEndsBeforeItStarts({ from: row.effective_from, until: row.effective_until }) ||
        periodOutsideSchedule(
          { from: row.effective_from, until: row.effective_until },
          { from: recurrence.startDate, until: recurrence.endDate },
        ),
      );
    if (outside) return t('admin.schedules.staffPeriodOutside');
    if (type === 'exam') {
      // The mode is refused by the server too; saying so here is the courtesy,
      // not the guarantee.
      if (examMode === 'online') return t('scheduling.exam.onlineSoon');
      // **R94 — she names a class, not a chain.** Without this the four
      // messages below would ask her for selectors she was never shown.
      if (!canAssignStaff && teachingContexts && examContextId === '') {
        return teachingContexts.length === 0
          ? t('scheduling.exam.noClassOfYours')
          : t('scheduling.invalid.forClass');
      }
      /**
       * **These four are the Admin's chain, and only hers** (R94).
       *
       * A مؤطرة named one of her own classes above, which states all four — and
       * `levelTeachesNothing` is computed from `listLevelSubjects`, another read
       * that answers 403 for her. Asking her to fix a Level that "teaches
       * nothing" would be the platform reporting its own blindness as her
       * mistake.
       */
      const suppliedByClass = !canAssignStaff && teachingContexts !== undefined;
      if (!suppliedByClass) {
        if (scope.value.branchId === '') return t('scheduling.invalid.branch');
        if (scope.value.levelId === '') return t('scheduling.invalid.level');
        if (scope.levelTeachesNothing) return t('scope.assignSubjectsHint');
        if (scope.value.subjectId === '') return t('scheduling.invalid.subject');
        if (scope.value.academicYearId === '') return t('scheduling.invalid.year');
      }
      if (roomId === '') return t('scheduling.invalid.room');
      if (startTime === '' || endTime === '') return t('scheduling.invalid.times');
      if (canAssignStaff && supervisorId === '') return t('scheduling.invalid.supervisor');
      return null;
    }
    if (type === 'activity' || type === 'holiday') {
      /**
       * **The activity's own scope was never checked** (2026-08-20).
       *
       * Every other kind states what it still needs; this one submitted an
       * empty id and let the server answer `VALIDATION_FAILED` with no field
       * named — so the reader saw «تعذّر الحفظ» about a choice nobody had asked
       * her to make. A مؤطرة with no group of her own is told that too, because
       * *there is nothing to choose* is a different answer from *choose one*.
       */
      if (scopeKind !== 'global' && scopeId === '') {
        return scopeOptionsEmpty
          ? t('scheduling.invalid.noScopeForYou')
          : t('scheduling.invalid.scope');
      }
      return null;
    }
    if (type === 'class') {
      if (scope.value.branchId === '') return t('scheduling.invalid.branch');
      if (scope.value.levelId === '') return t('scheduling.invalid.level');
      if (targetId === '') return t('scheduling.invalid.target');
      // **Points at the fix, not at the empty box.** With no `LevelSubject`
      // rows a Level teaches nothing, so *choose a subject* is unanswerable —
      // the remedy is on another screen, and naming it turns a dead end into a
      // next step (R43, R55).
      if (scope.levelTeachesNothing) return t('scope.assignSubjectsHint');
      if (scope.value.subjectId === '') return t('scheduling.invalid.subject');
      if (scope.value.academicYearId === '') return t('scheduling.invalid.year');
      if (startTime === '' || endTime === '') return t('scheduling.invalid.times');
      // A weekday-set pattern IS its days (§4.4) — an empty set produces a
      // schedule that materializes nothing, which looks like a silent failure.
      if (
        (recurrence.type === 'multiple_weekdays' ||
          (recurrence.type === 'biweekly_alternating' && recurrence.weekdays.length === 0)) &&
        recurrence.weekdays.length === 0
      ) {
        return t('scheduling.invalid.weekdays');
      }
      return null;
    }
    return null;
  }

  async function submit(): Promise<void> {
    const invalid = validationError();
    if (invalid !== null) {
      // The whole point: say what is wrong instead of doing nothing.
      setNotice(invalid);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveSchedulingItem(
        {
          type,
          title,
          description: description.trim() || null,
          startDate: recurrence.startDate,
          endDate: endDate || null,
          startTime: allDay && spec.hasAllDay ? null : startTime,
          endTime: allDay && spec.hasAllDay ? null : endTime,
          recurrence: recurrence.type,
          weekdays: recurrence.weekdays,
          repeatUntil: recurrence.endDate || null,
          visibility,
          // R110 — the catalogue row the picker chose, on every kind since
          // Owner 2026-09-02.
          schedulingTypeId,
          // R123 — who may mark at this item's occurrences.
          attendanceMarking,
          /**
           * **An unchosen scope is not an empty id** (2026-08-20).
           *
           * This sent `group_ids: ['']` when nothing was selected, and the
           * server answered `VALIDATION_FAILED` with **no field named** — so
           * the screen could only say «تعذّر الحفظ» about a scope the reader
           * had never been offered. `undefined` omits the key, and the form's
           * own completeness rule below names the missing choice instead.
           */
          scope:
            scopeKind === 'global'
              ? { global: true }
              : scopeId === ''
                ? undefined
                : scopeKind === 'branch'
                  ? { branchIds: [scopeId] }
                  : scopeKind === 'category'
                    ? { categoryIds: [scopeId] }
                    : scopeKind === 'group'
                      ? { groupIds: [scopeId] }
                      : { levelIds: [scopeId] },
          subjectId: scope.value.subjectId,
          levelId: scope.value.levelId,
          // `null` is the whole Level sitting together (R58), not a gap.
          examGroupId: scope.value.groupId || null,
          // **Her own sitting** (R94): a مؤطرة supervises what she organises,
          // and the server refuses any other name through
          // `assertExamInTeacherScope` regardless of what the form sends.
          examStaff: examStaffOf(
            canAssignStaff ? supervisorId : (me?.id ?? supervisorId),
            assistantIds,
          ),
          // R81 — required by the server on create; sent as a number so the
          // contract carries a grade maximum, not a form string.
          examMaxGrade: examMaxGrade.trim() === '' ? null : Number(examMaxGrade),
          // R71 — sent only when this caller may set it; the server refuses
          // otherwise, and sending it anyway would turn an ordinary save into
          // a refusal for a مؤطرة editing her own event.
          /**
           * **R71 for an Admin; her own event for a مؤطرة** (2026-08-20).
           *
           * This was sent only when the caller could assign staff, because the
           * server refused a مؤطرة outright — so she could create a celebration
           * and not name the people helping her run it. She may now, with the
           * responsible position pinned to **herself**: the server refuses any
           * other name, and sending her own id keeps that fact in the payload
           * rather than leaving it implied.
           */
          eventStaff: [
            ...(canAssignStaff
              ? responsibleId
                ? [{ user_id: responsibleId, position: 'responsible' as const }]
                : []
              : me?.id
                ? [{ user_id: me.id, position: 'responsible' as const }]
                : []),
            ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
          ],
          teachingMode: mode,
          targetId,
          branchId: scope.value.branchId,
          // **R97 — hidden means CLEARED, not merely unsubmitted** (§13). An
          // online class sends no room whatever was chosen before the switch,
          // and an in-person one sends no media mode; the server refuses either
          // combination anyway, and this keeps the payload honest about it.
          roomId: delivery === 'online' ? null : roomId || null,
          deliveryMode: delivery,
          onlineMediaMode: delivery === 'online' ? mediaMode : null,
          academicYearId: scope.value.academicYearId,
          /**
           * **R91 — the dated assignments, as typed.**
           *
           * A blank date is `null` on the wire, which is *open-ended at that
           * end*. Converted once, here, at the boundary: a date input produces
           * `''` and the contract wants `null`, and letting either leak into the
           * other half is how a bound silently becomes 1970.
           *
           * Rows with nobody chosen are dropped rather than refused — an empty
           * row is a row the administrator started and abandoned, not a request.
           */
          staff: staffing
            .filter((row) => row.user_id !== '')
            .map((row) => ({
              user_id: row.user_id,
              position: row.position,
              effective_from: row.effective_from === '' ? null : row.effective_from,
              effective_until: row.effective_until === '' ? null : row.effective_until,
            })),
        },
        item ? { id: item.id, version: item.version } : null,
        token,
      );
      onSaved(saved);
    } catch (error) {
      // A booking clash is the interesting failure and has its own code: the
      // room or a person is already committed on a materialized date, which is
      // a different remedy from any other refusal.
      if (error instanceof ApiError && error.code === 'SCHEDULE_CONFLICT') {
        setNotice(t('admin.schedules.clash'));
      } else if (
        error instanceof ApiError &&
        // **R91's interval invariants, in the administrator's words.** The
        // server names the rule in `details.reason`; a generic «تعذّر الحفظ»
        // would leave her to guess which of three date rules she broke.
        typeof (error.details as { reason?: string } | undefined)?.reason === 'string' &&
        STAFFING_REFUSALS[(error.details as { reason: string }).reason] !== undefined
      ) {
        setNotice(t(STAFFING_REFUSALS[(error.details as { reason: string }).reason]!));
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
      open
      title={t(editing ? 'scheduling.editTitle' : 'scheduling.create')}
      wide
      notice={notice}
      busy={busy}
      dirty={dirty}
      onCancel={onCancel}
      onSubmit={() => void submit()}
    >
      <SchedulingForm
        type={type}
        onTypeChange={setType}
        // A single permitted kind is already decided; offering a selector with
        // one option would ask a question with one answer.
        typeLocked={editing || types.length === 1}
        types={types}
        // R110 — the catalogue, narrowed by the kinds this caller may author.
        catalogue={catalogue}
        schedulingTypeId={schedulingTypeId}
        onSchedulingTypeChange={(row) => setSchedulingTypeId(row.id)}
        // R123 — the marking setting, and the structural fact that decides
        // whether `self_or_staff` may even be offered.
        attendanceMarking={attendanceMarking}
        onAttendanceMarkingChange={setAttendanceMarking}
        selfAttendanceAllowed={scope.selfAttendanceAllowed}
        // R109 (§D) — every kind carries a tier now, so the shell owns the
        // control and the sections no longer each keep one.
        visibility={visibility}
        onVisibility={setVisibility}
        title={title}
        onTitle={setTitle}
        // **R57 — every schedulable item is named by something a person typed.**
        // A class used to borrow its name from its Subject, which identifies it
        // and does not name it: two classes in one Subject for one group were
        // indistinguishable at a glance.
        showTitle={spec.hasTitle}
        description={description}
        onDescription={setDescription}
        showDescription={spec.hasDescription}
        showAllDay={spec.hasAllDay}
        allDay={allDay}
        onAllDay={setAllDay}
        startTime={startTime}
        endTime={endTime}
        onStartTime={setStartTime}
        onEndTime={setEndTime}
        showEndDate={spec.hasEndDate}
        endDate={endDate}
        onEndDate={setEndDate}
        recurrence={recurrence}
        onRecurrence={setRecurrence}
        allowOnce={spec.allowsOnce}
      >
        {type === 'class' ? (
          <ClassSection
            scope={scope}
            locked={editing}
            mode={mode}
            onMode={setMode}
            modes={MODES}
            rooms={rooms}
            roomId={roomId}
            onRoom={setRoomId}
            delivery={delivery}
            onDelivery={setDelivery}
            mediaMode={mediaMode}
            onMediaMode={setMediaMode}
            teachers={teachers}
            staffing={staffing}
            onStaffing={setStaffing}
            appraisal={appraisal}
            /* **The bounds the server measures against** (§5). `startDate` is
               the schedule's anchor and the recurrence end is R50's series
               bound — the same two values the payload sends as `startDate` and
               `repeatUntil`, so the form cannot warn about a different period
               from the one it saves. */
            scheduleFrom={recurrence.startDate}
            scheduleUntil={recurrence.endDate}
          />
        ) : type === 'exam' ? (
          <>
            {/**
              * **«الحصة المعنية» — one choice that sets the whole scope** (R94).
              *
              * An exam belongs to a Level, Subject, Branch and Year, and the
              * chain that offers those reads `/admin/levels`, which answers 403
              * for a مؤطرة. One of her own classes already states all four, so
              * she names the class and the form fills them in. An Admin keeps
              * the full chain, which is what her wider authority needs.
              */}
            {!canAssignStaff && teachingContexts ? (
              <SelectField
                label={t('scheduling.exam.forClass')}
                value={examContextId}
                onChange={(id: string) => {
                  setExamContextId(id);
                  const chosen = teachingContexts.find((c) => c.id === id);
                  if (!chosen) return;
                  scope.set('branchId', chosen.branchId);
                  scope.set('levelId', chosen.levelId);
                  scope.set('subjectId', chosen.subjectId);
                  scope.set('academicYearId', chosen.academicYearId);
                  scope.set('groupId', chosen.groupId ?? '');
                }}
                hint={t('scheduling.exam.forClassHint')}
                options={[
                  { value: '', label: t('common.choose') },
                  ...teachingContexts.map((c) => ({ value: c.id, label: c.title })),
                ]}
              />
            ) : null}
            <ExamSection
            mode={examMode}
            onMode={setExamMode}
            scope={scope}
            locked={editing}
            rooms={rooms}
            roomId={roomId}
            onRoom={setRoomId}
            staff={teachers}
            supervisorId={supervisorId}
            onSupervisor={setSupervisorId}
            assistantIds={assistantIds}
            onAssistants={setAssistantIds}
            maxGrade={examMaxGrade}
            onMaxGrade={setExamMaxGrade}
            // Her scope came from the class she named; showing the chain she
            // cannot populate would be four empty selectors.
            hideScope={!canAssignStaff && teachingContexts !== undefined}
            leadStaff={
              canAssignStaff ? teachers : teachers.filter((x) => x.id === me?.id)
            }
            leadLocked={!canAssignStaff}
            />
          </>
        ) : (
          <ActivitySection
            scopeKind={scopeKind}
            onScopeKind={setScopeKind}
            scopeId={scopeId}
            onScopeId={setScopeId}
            /**
             * **A مؤطرة is offered only herself as responsible** (2026-08-20).
             *
             * She may now staff her own event, and the one thing she may not do
             * is hand it to somebody else — so the selector holds exactly one
             * name. Not a hidden control: the list she is offered is the list
             * the server will accept, and a forged body naming anybody else is
             * refused there (`RESPONSIBLE_MUST_BE_SELF`).
             *
             * **The assistants list stays whole**, because choosing who helps
             * her run it is precisely the thing this grant is for.
             */
            staff={teachers}
            leadStaff={
              canAssignStaff ? teachers : teachers.filter((x) => x.id === me?.id)
            }
            responsibleId={canAssignStaff ? responsibleId : (me?.id ?? '')}
            onResponsible={setResponsibleId}
            responsibleLocked={!canAssignStaff}
            assistantIds={assistantIds}
            onAssistants={setAssistantIds}
            canAssignStaff={canAssignStaff}
            scopeKinds={
              // عطلة first: it is the narrowest, and a Teacher never reaches it
              // (creating one is an administrative act).
              type === 'holiday'
                ? HOLIDAY_SCOPE_KINDS
                : canAssignStaff
                  ? undefined
                  : TEACHER_SCOPE_KINDS
            }
            /**
             * **Her own groups, from the read that answers her** (R93).
             *
             * The Admin chain builds these from `/admin/levels` and
             * `/admin/academic-years`, both **403** for a مؤطرة — so her group
             * selector was empty and the form let her fill everything in before
             * failing on save. An Admin's options are unchanged.
             */
            scopeOptions={
              !canAssignStaff
                ? teacherScopes
                : scopeKind === 'branch'
                  ? scope.options.branchId.map((o) => ({ id: o.value, name: o.label }))
                  : scopeKind === 'category'
                    ? scope.options.categoryId.map((o) => ({ id: o.value, name: o.label }))
                    : scopeKind === 'group'
                      ? scope.options.groupId.map((o) => ({ id: o.value, name: o.label }))
                      : scope.options.levelId.map((o) => ({ id: o.value, name: o.label }))
            }
            locked={editing}
          />
        )}
      </SchedulingForm>
    </FormDialog>
  );
}

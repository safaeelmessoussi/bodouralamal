import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  fetchCalendarBootstrap,
  fetchOccurrences,
  type CalendarBootstrap,
  type HijriDay,
  type Occurrence,
} from '../../adapters/calendar.js';
import { listRooms } from '../../adapters/branches-admin.js';
import { AVAILABLE_TYPES, specOfType } from '../../adapters/scheduling-types.js';
import {
  deleteSchedulingItem,
  listSchedulingItems,
  saveSchedulingItem,
  type SchedulingItem,
  type SchedulingType,
} from '../../adapters/scheduling.js';
import { searchUsers, type UserSummary } from '../../adapters/users.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { CalendarGrid } from '../../components/calendar/calendar-grid.js';
import { CalendarNav } from '../../components/calendar/calendar-nav.js';
import { CalendarTitle } from '../../components/calendar/calendar-title.js';
import { DayEventsDialog } from '../../components/calendar/day-events-dialog.js';
import {
  ActivitySection,
  ClassSection,
  TEACHER_SCOPE_KINDS,
} from '../../components/scheduling/class-section.js';
import { ExamSection, examStaffOf } from '../../components/scheduling/exam-section.js';
import { SchedulingForm } from '../../components/scheduling/scheduling-form.js';
import { patternOf, type RecurrenceValue } from '../../components/scheduling/recurrence-editor.js';
import { ScopeSelectors } from '../../components/scope/scope-selectors.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import {
  DataTable,
  type Column,
  type RowAction,
  type TableStatus,
} from '../../components/ui/data-table.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { SelectField } from '../../components/ui/field.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

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
const SCOPE_FIELDS = ['branchId', 'levelId', 'groupId', 'subjectId', 'academicYearId'] as const;
/** What the LIST filters by. A module constant like every other caller's —
 *  the hook no longer depends on identity, but a stable list is still the
 *  clearer way to say "these fields, always". */
const LIST_SCOPE = ['branchId', 'levelId', 'subjectId', 'academicYearId'] as const;

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function SchedulingPage(): ReactNode {
  const { accessToken } = useSession();
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'calendar' ? 'calendar' : 'list',
  );

  const [items, setItems] = useState<SchedulingItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [typeFilter, setTypeFilter] = useState<SchedulingType | ''>('');
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

  const listScope = useScopeOptions({ token: accessToken, fields: LIST_SCOPE });

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await listSchedulingItems(accessToken, {
        type: typeFilter,
        ...(listScope.value.branchId ? { branchId: listScope.value.branchId } : {}),
        ...(listScope.value.subjectId ? { subjectId: listScope.value.subjectId } : {}),
        ...(listScope.value.academicYearId
          ? { academicYearId: listScope.value.academicYearId }
          : {}),
      });
      setItems(result.items);
      setTruncated(result.truncated);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [
    accessToken,
    typeFilter,
    listScope.value.branchId,
    listScope.value.subjectId,
    listScope.value.academicYearId,
  ]);

  useEffect(() => {
    if (view === 'list') void load();
  }, [load, view]);

  const columns: Column<SchedulingItem>[] = [
    {
      key: 'type',
      header: t('scheduling.itemType'),
      // The badge carries the same colour the calendar chip does, from the same
      // token — an exam is recognisable at a glance on either surface.
      cell: (r) => <span className={`badge badge--${r.type}`}>{t(`scheduling.type.${r.type}`)}</span>,
    },
    {
      key: 'title',
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
      key: 'recurrence',
      header: t('scheduling.recurrence'),
      secondary: true,
      cell: (r) => t(`scheduling.pattern.${patternOf({ type: r.recurrence, weekdays: r.weekdays })}`),
    },
    {
      key: 'branch',
      header: t('admin.schedules.branch'),
      secondary: true,
      cell: (r) => r.branchName ?? <span className="muted">—</span>,
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
      available: (r) => specOfType(r.type).hasOccurrences,
    },
    { label: t('common.edit'), onSelect: (r) => setEditing(r) },
    { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteSchedulingItem(deleting, accessToken);
      setDeleting(null);
      await load();
      setNotice(t('common.deleted'));
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
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {/* The view is a query parameter, not a second navigation node (§20 rule
          16) — the same choice §5.2's library made for its two views. */}
      <div className="cal-toolbar" role="tablist" aria-label={t('scheduling.viewLabel')}>
        {(['list', 'calendar'] as const).map((v) => (
          <Button
            key={v}
            variant={view === v ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={view === v}
            onClick={() => {
              setView(v);
              const url = new URL(window.location.href);
              url.searchParams.set('view', v);
              window.history.replaceState(null, '', url);
            }}
          >
            {t(`scheduling.view.${v}`)}
          </Button>
        ))}
      </div>

      {view === 'list' ? (
        <>
          <DataTable
            caption={t('admin.nav.scheduling')}
            columns={columns}
            rows={items}
            rowKey={(r) => `${r.type}:${r.id}`}
            status={status}
            actions={actions}
            onRetry={() => void load()}
            filtered={typeFilter !== '' || listScope.value.branchId !== ''}
            onClearFilters={() => {
              setTypeFilter('');
              listScope.setMany({ branchId: '', levelId: '', subjectId: '', academicYearId: '' });
            }}
            toolbar={
              <>
                <SelectField
                  label={t('scheduling.itemType')}
                  value={typeFilter}
                  onChange={(v) => setTypeFilter(v as SchedulingType | '')}
                  options={[
                    { value: '', label: t('scheduling.allTypes') },
                    // Derived from the registry, not listed again: R56's promise
                    // is that a new kind is ONE entry, and a hand-written filter
                    // is exactly the copy that silently omits it.
                    ...AVAILABLE_TYPES.map((k) => ({ value: k, label: t(`scheduling.type.${k}`) })),
                  ]}
                />
                <ScopeSelectors scope={listScope} fields={LIST_SCOPE} mode="filter" />
              </>
            }
          />
          {/* Stated rather than hidden: merging two independently paginated
              sources cannot produce a correct combined page without reading
              both, so the combined view reads one page of each and says so. */}
          {truncated ? <p className="muted">{t('scheduling.truncated')}</p> : null}
        </>
      ) : (
        <CalendarView />
      )}

      {editing ? (
        <SchedulingDialog
          item={editing === 'new' ? null : editing}
          {...(editing === 'new' && initialType ? { initialType } : {})}
          token={accessToken}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice(t('common.saved'));
            void load();
          }}
        />
      ) : null}

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
function CalendarView(): ReactNode {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [bootstrap, setBootstrap] = useState<CalendarBootstrap | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);

  useEffect(() => {
    const from = startOfMonth(month);
    const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    // `GET /calendar` is public with optional authentication: the credential
    // travels on the request and REORDERS nothing here, it only widens the tier
    // a staff caller sees (§5.2). The adapter reads the session itself.
    void fetchOccurrences({ from: iso(from), to: iso(to) })
      .then((r) => setOccurrences(r.occurrences))
      .catch(() => setOccurrences([]));
    // **The Hijri overlay comes from the same bootstrap the public calendar
    // reads** (R31–32): recorded Ministry announcements, never a computation.
    // This view passed an empty map, so the back office was the one calendar in
    // the platform showing no Hijri date at all — a regression, not a decision.
    void fetchCalendarBootstrap({ from: iso(from), to: iso(to) })
      .then(setBootstrap)
      .catch(() => setBootstrap(null));
  }, [month]);

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
      {/* **The same header and the same navigation the public calendar uses.**
          The dual title is where the Gregorian month is named beside its Hijri
          month (R31, R36) — rebuilding it here with plain buttons, as this view
          first did, left the back office without the Hijri side entirely. */}
      <div className="cal-toolbar">
        <CalendarTitle
          gregorianMonths={bootstrap?.gregorian_months ?? []}
          hijriMonths={bootstrap?.hijri.months ?? []}
          month={month}
        />
        <CalendarNav
          onPrevious={() => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
          onToday={() => setMonth(startOfMonth(today))}
          onNext={() => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
        />
      </div>

      <CalendarGrid
        month={month}
        byDate={byDate}
        hijriByDate={hijriByDate}
        today={today}
        selected={openDay}
        onSelect={setOpenDay}
        onOpenEvent={() => undefined}
      />

      <DayEventsDialog
        date={openDay}
        hijri={null}
        occurrences={openDay ? (byDate.get(iso(openDay)) ?? []) : []}
        onClose={() => setOpenDay(null)}
        onOpenEvent={() => undefined}
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
  initialType,
}: {
  item: SchedulingItem | null;
  token: string | null;
  onCancel: () => void;
  onSaved: () => void;
  /** R72 — the kinds this caller may create. One kind locks the field. */
  types?: readonly SchedulingType[];
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
    type: item?.recurrence ?? (item?.type === 'activity' ? 'none' : 'weekly'),
    weekdays: item?.weekdays ?? [],
    startDate: item?.startDate ?? '',
    endDate: item?.repeatUntil ?? '',
  });

  const [mode, setMode] = useState<string>('administrative_group');
  const [roomId, setRoomId] = useState(item?.ids.roomId ?? '');
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number | null }[]>([]);
  // `RoomDto` publishes no `capacity` — BR-23 makes it informational and it is
  // enforced nowhere, so putting it on this wire is a further contract change
  // and is recorded as such rather than smuggled in here.
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [teacherId, setTeacherId] = useState(
    item?.ids.staff.find((x) => x.position === 'teacher')?.user_id ?? '',
  );
  const [assistantIds, setAssistantIds] = useState<string[]>(
    (item?.ids.staff ?? []).filter((x) => x.position === 'assistant').map((x) => x.user_id),
  );
  // An exam already saved is physical: `online` cannot be stored (§4.6, R58).
  const [examMode, setExamMode] = useState<'physical' | 'online'>('physical');
  const [supervisorId, setSupervisorId] = useState(
    item?.ids.staff.find((x) => x.position === 'supervisor')?.user_id ?? '',
  );
  // R71 — who answers for an event. Prefilled from the item's own rows, so
  // editing a celebration shows the مؤطرة already responsible for it.
  // R60 — the ACTIVE role, so a Super Admin working as مؤطِّرة is not offered a
  // control the server will refuse. R71.4 keeps event staffing with Admins.
  const { activeRoles } = useActiveRole();
  const canAssignStaff = activeRoles.some((r) => r === 'admin' || r === 'super_admin');

  const [responsibleId, setResponsibleId] = useState(
    item?.ids.staff.find((x) => x.position === 'responsible')?.user_id ?? '',
  );
  const [visibility, setVisibility] = useState('public');
  // R72 — a Teacher may scope an event to their own groups and nothing else
  // (TD-2, §4.9), so `global` would be a default the server refuses.
  const [scopeKind, setScopeKind] = useState(canAssignStaff ? 'global' : 'group');
  const [scopeId, setScopeId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const spec = specOfType(type);

  useEffect(() => {
    void searchUsers(token, { role: 'teacher' }).then((p) => setTeachers(p.data));
  }, [token]);

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
    if (recurrence.startDate === '') return t('scheduling.invalid.startDate');
    if (type === 'exam') {
      // The mode is refused by the server too; saying so here is the courtesy,
      // not the guarantee.
      if (examMode === 'online') return t('scheduling.exam.onlineSoon');
      if (scope.value.branchId === '') return t('scheduling.invalid.branch');
      if (scope.value.levelId === '') return t('scheduling.invalid.level');
      if (scope.levelTeachesNothing) return t('scope.assignSubjectsHint');
      if (scope.value.subjectId === '') return t('scheduling.invalid.subject');
      if (scope.value.academicYearId === '') return t('scheduling.invalid.year');
      if (roomId === '') return t('scheduling.invalid.room');
      if (startTime === '' || endTime === '') return t('scheduling.invalid.times');
      if (supervisorId === '') return t('scheduling.invalid.supervisor');
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
      await saveSchedulingItem(
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
          scope:
            scopeKind === 'global'
              ? { global: true }
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
          examStaff: examStaffOf(supervisorId, assistantIds),
          // R71 — sent only when this caller may set it; the server refuses
          // otherwise, and sending it anyway would turn an ordinary save into
          // a refusal for a مؤطرة editing her own event.
          ...(canAssignStaff
            ? {
                eventStaff: [
                  ...(responsibleId
                    ? [{ user_id: responsibleId, position: 'responsible' as const }]
                    : []),
                  ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
                ],
              }
            : {}),
          teachingMode: mode,
          targetId,
          branchId: scope.value.branchId,
          roomId: roomId || null,
          academicYearId: scope.value.academicYearId,
          staff: [
            ...(teacherId ? [{ user_id: teacherId, position: 'teacher' as const }] : []),
            ...assistantIds.map((id) => ({ user_id: id, position: 'assistant' as const })),
          ],
        },
        item ? { id: item.id, version: item.version } : null,
        token,
      );
      onSaved();
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
      open
      title={t(editing ? 'scheduling.editTitle' : 'scheduling.create')}
      wide
      notice={notice}
      busy={busy}
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
            teachers={teachers}
            teacherId={teacherId}
            onTeacher={setTeacherId}
            assistantIds={assistantIds}
            onAssistants={setAssistantIds}
          />
        ) : type === 'exam' ? (
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
          />
        ) : (
          <ActivitySection
            visibility={visibility}
            onVisibility={setVisibility}
            scopeKind={scopeKind}
            onScopeKind={setScopeKind}
            scopeId={scopeId}
            onScopeId={setScopeId}
            staff={teachers}
            responsibleId={responsibleId}
            onResponsible={setResponsibleId}
            assistantIds={assistantIds}
            onAssistants={setAssistantIds}
            canAssignStaff={canAssignStaff}
            scopeKinds={canAssignStaff ? undefined : TEACHER_SCOPE_KINDS}
            scopeOptions={
              scopeKind === 'branch'
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

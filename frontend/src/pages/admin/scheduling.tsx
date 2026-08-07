import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchOccurrences, type Occurrence } from '../../adapters/calendar.js';
import { listRooms } from '../../adapters/branches-admin.js';
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
import { DayEventsDialog } from '../../components/calendar/day-events-dialog.js';
import { ActivitySection, ClassSection } from '../../components/scheduling/class-section.js';
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
  const [editing, setEditing] = useState<SchedulingItem | 'new' | null>(null);
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
      cell: (r) => t(`scheduling.type.${r.type}`),
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
      available: (r) => r.type === 'class',
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
        <Button variant="primary" onClick={() => setEditing('new')}>
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
                    { value: 'class', label: t('scheduling.type.class') },
                    { value: 'activity', label: t('scheduling.type.activity') },
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
  }, [month]);

  const byDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      map.set(o.date, [...(map.get(o.date) ?? []), o]);
    }
    return map;
  }, [occurrences]);

  return (
    <div aria-live="polite">
      <div className="cal-toolbar">
        <Button
          variant="ghost"
          onClick={() =>
            setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))
          }
        >
          {t('calendar.previousMonth')}
        </Button>
        <Button variant="ghost" onClick={() => setMonth(startOfMonth(today))}>
          {t('calendar.today')}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))
          }
        >
          {t('calendar.nextMonth')}
        </Button>
      </div>

      <CalendarGrid
        month={month}
        byDate={byDate}
        // The Hijri overlay is decorative and read from recorded official
        // announcements (R31–32); the back office does not need it to schedule.
        hijriByDate={new Map()}
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
function SchedulingDialog({
  item,
  token,
  onCancel,
  onSaved,
}: {
  item: SchedulingItem | null;
  token: string | null;
  onCancel: () => void;
  onSaved: () => void;
}): ReactNode {
  const editing = item !== null;
  const [type, setType] = useState<SchedulingType>(item?.type ?? 'class');
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
  const [roomId, setRoomId] = useState('');
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number | null }[]>([]);
  // `RoomDto` publishes no `capacity` — BR-23 makes it informational and it is
  // enforced nowhere, so putting it on this wire is a further contract change
  // and is recorded as such rather than smuggled in here.
  const [teachers, setTeachers] = useState<UserSummary[]>([]);
  const [teacherId, setTeacherId] = useState('');
  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('public');
  const [scopeKind, setScopeKind] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scope = useScopeOptions({ token, fields: SCOPE_FIELDS, defaultCurrentYear: true });

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
    if (recurrence.startDate === '') return t('scheduling.invalid.startDate');
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
    if (title.trim() === '') return t('scheduling.invalid.title');
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
          startTime: allDay && type !== 'class' ? null : startTime,
          endTime: allDay && type !== 'class' ? null : endTime,
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
                  : { levelIds: [scopeId] },
          subjectId: scope.value.subjectId,
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
        typeLocked={editing}
        title={title}
        onTitle={setTitle}
        // A class is named by its Subject (§4.4c) and has no title column;
        // a free-text one would be a second way to say the same thing.
        showTitle={type !== 'class'}
        description={description}
        onDescription={setDescription}
        showDescription={type !== 'class'}
        showAllDay={type !== 'class'}
        allDay={allDay}
        onAllDay={setAllDay}
        startTime={startTime}
        endTime={endTime}
        onStartTime={setStartTime}
        onEndTime={setEndTime}
        showEndDate={type !== 'class'}
        endDate={endDate}
        onEndDate={setEndDate}
        recurrence={recurrence}
        onRecurrence={setRecurrence}
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
        ) : (
          <ActivitySection
            visibility={visibility}
            onVisibility={setVisibility}
            scopeKind={scopeKind}
            onScopeKind={setScopeKind}
            scopeId={scopeId}
            onScopeId={setScopeId}
            scopeOptions={
              scopeKind === 'branch'
                ? scope.options.branchId.map((o) => ({ id: o.value, name: o.label }))
                : scopeKind === 'category'
                  ? scope.options.categoryId.map((o) => ({ id: o.value, name: o.label }))
                  : scope.options.levelId.map((o) => ({ id: o.value, name: o.label }))
            }
            locked={editing}
          />
        )}
      </SchedulingForm>
    </FormDialog>
  );
}

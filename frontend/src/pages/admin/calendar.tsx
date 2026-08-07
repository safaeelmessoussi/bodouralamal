import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { fetchCalendarBootstrap, fetchOccurrences, type Occurrence } from '../../adapters/calendar.js';
import {
  createEvent,
  deleteEvent,
  type EventInput,
  type EventRecurrence,
  type EventVisibility,
} from '../../adapters/events.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { FormDialog } from '../../components/ui/form-dialog.js';
import { DataTable, type Column, type RowAction, type TableStatus } from '../../components/ui/data-table.js';
import {
  RecurrenceEditor,
  SchedulingTimes,
} from '../../components/scheduling/recurrence-editor.js';
import { DateField, SelectField, TextArea, TextField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

const VISIBILITIES: EventVisibility[] = ['public', 'private', 'hidden'];

/** One event, as this screen reasons about it — an event row, not an occurrence. */
interface EventRowView {
  id: string;
  title: string;
  description: string | null;
  visibility: string | null;
  recurrence: string | null;
  branch_name: string | null;
  category_name: string | null;
  level_name: string | null;
  /** How many times it falls inside the window being listed. The honest count
   *  of *what the calendar will show*, not a property of the event. */
  occurrences: number;
  /** The first date in the window — what the list sorts by. */
  first_date: string;
}

/**
 * `/admin/calendar` — the **non-teaching activity layer** (§4.4, §5.6, §14.1).
 *
 * Holidays, vacations, ceremonies, exams, one-off activities. **An Event never
 * generates Sessions**, and a teaching occurrence is never an Event — Course
 * Schedules are a separate screen for a separate model, and conflating them is
 * what §20 rule 22 forbids.
 *
 * **The list is built from `GET /calendar`, deduplicated by event id.** There is
 * no `GET /events` and none was invented (§20 rule 16): the calendar already
 * returns every event this caller may see, as occurrences carrying the event's
 * own id. A recurring event appears once per date there and **once here** —
 * which is the correct reading of each surface: the calendar shows *when it
 * happens*, this screen shows *what was created*.
 *
 * **The window is explicit, and the count is honest about it.** An event outside
 * the chosen months is not listed, because the endpoint is date-bounded and
 * pretending otherwise would mean claiming a completeness this screen cannot
 * have. The `occurrences` column counts dates **inside the window**, and the
 * heading says so.
 *
 * **Scope is set at creation and not editable here**, because the server refuses
 * it on `PATCH`: changing who an event applies to is a re-scoping rather than an
 * edit, and a form offering a field the API rejects teaches the wrong model.
 */
export function AdminCalendarPage(): ReactNode {
  const { accessToken } = useSession();

  const [rows, setRows] = useState<EventRowView[]>([]);
  const [status, setStatus] = useState<TableStatus>('loading');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [levels, setLevels] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState(() => monthStart(new Date()));
  const [to, setTo] = useState(() => monthEnd(addMonths(new Date(), 5)));
  const [editing, setEditing] = useState<EventRowView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<EventRowView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { occurrences } = await fetchOccurrences({ from, to });
      setRows(collapseEvents(occurrences));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The scope pickers. A failed load leaves the list working and only the
    // create form's scope empty — reference data must not take a screen down.
    void fetchCalendarBootstrap({ from, to })
      .then((b) => {
        setBranches(b.branches);
        setCategories(b.categories);
        setLevels(b.levels);
      })
      .catch(() => undefined);
    // Loaded once for the form; the window filter does not change the vocabulary.
  }, []);

  const columns: Column<EventRowView>[] = [
    { key: 'title', header: t('admin.calendar.colTitle'), cell: (r) => r.title },
    {
      key: 'visibility',
      header: t('admin.calendar.colVisibility'),
      // Announced as a word — colour never carries meaning alone (§14.4).
      cell: (r) => (r.visibility ? t(`calendar.visibility${cap(r.visibility)}`) : '—'),
    },
    {
      key: 'recurrence',
      header: t('admin.calendar.colRecurrence'),
      cell: (r) => (r.recurrence ? t(`calendar.recurrence.${r.recurrence}`) : '—'),
    },
    {
      key: 'scope',
      header: t('admin.calendar.colScope'),
      secondary: true,
      // `null` everywhere is the **Global / بدون فرع** scope (§4.4), which is a
      // value rather than a gap — an event that applies to everyone.
      cell: (r) =>
        r.branch_name ?? r.category_name ?? r.level_name ?? (
          <span className="muted">{t('admin.calendar.scopeGlobal')}</span>
        ),
    },
    {
      key: 'first',
      header: t('admin.calendar.colFirst'),
      secondary: true,
      cell: (r) => <time dateTime={r.first_date}>{r.first_date}</time>,
    },
    {
      key: 'count',
      header: t('admin.calendar.colOccurrences'),
      numeric: true,
      cell: (r) => r.occurrences as ReactNode,
    },
  ];

  const actions: RowAction<EventRowView>[] = [
    { label: t('common.delete'), danger: true, onSelect: (r) => setDeleting(r) },
  ];

  async function save(input: EventInput, existing: EventRowView | null): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      if (existing) {
        // Scope keys are refused by the server on PATCH, so they are not sent.
        const { global, branch_ids, category_ids, level_ids, group_ids, ...own } = input;
        void global;
        void branch_ids;
        void category_ids;
        void level_ids;
        void group_ids;
        // **This page cannot edit, and never could.** `PATCH /events` requires
        // TD-15's `version`, and this list shows calendar *occurrences*, which
        // carry none because they are not rows — so every edit from here has
        // returned `400 VALIDATION_FAILED`. The unified Scheduling page (R56)
        // lists definitions, which do carry it. Until this page is retired the
        // action is withdrawn rather than left to fail silently (§14.2).
        throw new ApiError(400, null);
        void own;
      } else {
        await createEvent(input, accessToken);
      }
      setEditing(null);
      await load();
      setNotice(t(existing ? 'common.saved' : 'common.created'));
    } catch (error) {
      setNotice(t(error instanceof ApiError && error.status === 409 ? 'common.conflict' : 'common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteEvent(deleting.id, accessToken);
      await load();
      setNotice(t('admin.calendar.deleted'));
    } catch {
      setNotice(t('common.deleteFailed'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <AdminLayout
      title={t('admin.nav.calendar')}
      lede={t('admin.calendar.lede')}
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('admin.calendar.create')}
        </Button>
      }
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <DataTable
        caption={t('admin.calendar.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        status={status}
        actions={actions}
        onRetry={() => void load()}
        toolbar={
          <>
            {/* The window is a real input, not chrome: the endpoint is
                date-bounded, so what is listed depends on it and the reader
                needs to see which dates they are looking at. */}
            <DateField label={t('admin.calendar.from')} value={from} onChange={setFrom} />
            <DateField label={t('admin.calendar.to')} value={to} onChange={setTo} />
          </>
        }
      />

      <p className="muted">{t('admin.calendar.windowNote')}</p>

      {editing ? (
        <EventFormDialog
          event={editing === 'new' ? null : editing}
          branches={branches}
          categories={categories}
          levels={levels}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void save(input, editing === 'new' ? null : editing)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.calendar.deleteTitle')}
        body={t('admin.calendar.deleteBody').replace('{title}', deleting?.title ?? '')}
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
 * Occurrences → the events that produced them.
 *
 * **The dedupe is the whole trick that made this screen need no new endpoint.**
 * `GET /calendar` expands a recurrence into one occurrence per date, each
 * carrying the event's own id, so grouping by id recovers exactly the rows an
 * administrator created — with a count of how many dates fall in the window,
 * which is a genuinely useful thing the event row itself does not know.
 */
export function collapseEvents(occurrences: Occurrence[]): EventRowView[] {
  const byId = new Map<string, EventRowView>();
  for (const o of occurrences) {
    if (o.kind !== 'event') continue;
    const existing = byId.get(o.id);
    if (existing) {
      existing.occurrences += 1;
      // Occurrences arrive in date order, but a later one must never move the
      // first date backwards if that ever stops being true.
      if (o.date < existing.first_date) existing.first_date = o.date;
      continue;
    }
    byId.set(o.id, {
      id: o.id,
      title: o.title,
      description: o.description,
      visibility: o.visibility,
      recurrence: o.recurrence,
      branch_name: o.branch_name,
      category_name: o.category_name,
      level_name: o.level_name,
      occurrences: 1,
      first_date: o.date,
    });
  }
  return [...byId.values()].sort((a, b) => a.first_date.localeCompare(b.first_date));
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const monthStart = (d: Date): string => iso(new Date(d.getFullYear(), d.getMonth(), 1));
const monthEnd = (d: Date): string => iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const addMonths = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth() + n, d.getDate());

/**
 * The event form.
 *
 * **Scope appears only on create.** `PATCH /events/{id}` refuses scope keys
 * rather than dropping them — re-scoping an event is not an edit — so offering
 * them on an edit would be a control the server would reject.
 *
 * **Times are plain text, not a native time input** (TD-11): a wall-clock value
 * travels as `HH:MM`, and a native control hands back a locale-dependent
 * rendering in some browsers.
 */
function EventFormDialog({
  event,
  branches,
  categories,
  levels,
  busy,
  onSave,
  onCancel,
}: {
  event: EventRowView | null;
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  busy: boolean;
  onSave: (input: EventInput) => void;
  onCancel: () => void;
}): ReactNode {
  const [form, setForm] = useState({
    title: event?.title ?? '',
    description: event?.description ?? '',
    visibility: (event?.visibility as EventVisibility) ?? 'public',
    startDate: iso(new Date()),
    endDate: '',
    startTime: '',
    endTime: '',
    recurrence: (event?.recurrence as EventRecurrence) ?? 'none',
    recurrenceEnd: '',
    scope: 'global' as 'global' | 'branch' | 'category' | 'level',
    scopeId: '',
  });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const titleError = form.title.trim() === '' ? t('common.required') : null;
  const scopeError =
    form.scope !== 'global' && form.scopeId === '' ? t('common.required') : null;
  const valid = titleError === null && (event !== null || scopeError === null);

  const scopeOptions =
    form.scope === 'branch' ? branches : form.scope === 'category' ? categories : levels;

  /** The payload, named rather than inlined into a button — the dialog owns the
   *  button now, and a form's save logic reads better beside its state anyway. */
  function submit(): void {
    const blank = (v: string): string | null => (v.trim() === '' ? null : v.trim());
    onSave({
      title: form.title.trim(),
      description: blank(form.description),
      visibility: form.visibility,
      start_date: form.startDate,
      end_date: blank(form.endDate),
      start_time: blank(form.startTime),
      end_time: blank(form.endTime),
      recurrence_type: form.recurrence,
      recurrence_end_date: form.recurrence === 'none' ? null : blank(form.recurrenceEnd),
      ...(event
        ? {}
        : form.scope === 'global'
          ? { global: true }
          : form.scope === 'branch'
            ? { branch_ids: [form.scopeId] }
            : form.scope === 'category'
              ? { category_ids: [form.scopeId] }
              : { level_ids: [form.scopeId] }),
    });
  }

  return (
    <FormDialog
      open
      title={t(event ? 'admin.calendar.editTitle' : 'admin.calendar.create')}
      wide
      busy={busy}
      onCancel={onCancel}
      onSubmit={() => {
        setTouched(true);
        if (!valid) return;
        submit();
      }}
    >
      <>
        <TextField
          label={t('admin.calendar.colTitle')}
          value={form.title}
          onChange={set('title')}
          required
          error={touched ? titleError : null}
        />
        <TextArea
          label={t('admin.calendar.description')}
          value={form.description}
          onChange={set('description')}
          rows={3}
        />
        <div className="form__row">
          <SelectField
            label={t('admin.calendar.colVisibility')}
            value={form.visibility}
            onChange={(v) => set('visibility')(v as EventVisibility)}
            options={VISIBILITIES.map((v) => ({
              value: v,
              label: t(`calendar.visibility${cap(v)}`),
            }))}
            hint={t('admin.calendar.visibilityHint')}
          />
        </div>
        {/* The SHARED control (§4.4). An administrator who edits a class next
            sees the same field, in the same place, with the same words — which
            is the objective; the fields inside differ because the two models
            genuinely differ. */}
        <RecurrenceEditor
          value={{
            type: form.recurrence,
            // An Event's rule carries no weekday set; the editor keeps the key
            // and simply never shows the checkboxes for these patterns.
            weekdays: [],
            startDate: form.startDate,
            endDate: form.recurrenceEnd,
          }}
          onChange={(next) =>
            setForm((f) => ({
              ...f,
              recurrence: next.type as EventRecurrence,
              startDate: next.startDate,
              recurrenceEnd: next.endDate,
            }))
          }
        />
        <div className="form__row">
          <DateField
            label={t('admin.calendar.startDate')}
            value={form.startDate}
            onChange={set('startDate')}
            required
          />
          <DateField
            label={t('admin.calendar.endDate')}
            value={form.endDate}
            onChange={set('endDate')}
            hint={t('admin.calendar.endDateHint')}
          />
        </div>
        {/* Shared, and identical on both screens. */}
        <SchedulingTimes
          startTime={form.startTime}
          endTime={form.endTime}
          onStart={set('startTime')}
          onEnd={set('endTime')}
        />

        {event ? (
          // Not offered, and the reason is stated: the server refuses scope on
          // an edit, so a control here could only fail.
          <p className="muted">{t('admin.calendar.scopeLocked')}</p>
        ) : (
          <div className="form__row">
            <SelectField
              label={t('admin.calendar.colScope')}
              value={form.scope}
              onChange={(v) => setForm((f) => ({ ...f, scope: v as typeof f.scope, scopeId: '' }))}
              options={[
                { value: 'global', label: t('admin.calendar.scopeGlobal') },
                { value: 'branch', label: t('admin.calendar.scopeBranch') },
                { value: 'category', label: t('admin.calendar.scopeCategory') },
                { value: 'level', label: t('admin.calendar.scopeLevel') },
              ]}
              hint={t('admin.calendar.scopeHint')}
            />
            {form.scope === 'global' ? null : (
              <SelectField
                label={t('common.choose')}
                value={form.scopeId}
                onChange={set('scopeId')}
                required
                error={touched ? scopeError : null}
                options={[
                  { value: '', label: t('common.choose') },
                  ...scopeOptions.map((o) => ({ value: o.id, label: o.name })),
                ]}
              />
            )}
          </div>
        )}

      </>
    </FormDialog>
  );

}

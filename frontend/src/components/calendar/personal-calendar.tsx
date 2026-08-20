import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  fetchCalendarBootstrap,
  fetchMyOccurrences,
  type CalendarBootstrap,
  type HijriDay,
  type Occurrence,
} from '../../adapters/calendar.js';
import {
  useCalendarFilters,
  type CalendarFilterField,
} from '../../hooks/use-calendar-filters.js';
import { t } from '../../i18n/index.js';
import { CalendarFilters } from './calendar-filters.js';
import { CalendarGrid } from './calendar-grid.js';
import { CalendarHeader } from './calendar-header.js';
import { DayEventsDialog } from './day-events-dialog.js';
import { EventDetailsDialog } from './event-details-dialog.js';
import { OccurrenceTable, type OccurrenceColumn } from './occurrence-table.js';
import { viewFromUrl, type CalendarView } from './view-switch.js';

/**
 * **A person's own calendar — the same components, a narrower read** (R83.5).
 *
 * R82.8 gave `GET /me/calendar` its meaning and left it unreachable: a
 * beneficiary still had no calendar at all, and a مؤطرة saw only her schedule
 * list. This is that endpoint's screen, and it is deliberately **not a new
 * calendar**: the header, the grid, the list, the day dialog and the filter
 * state are the shared ones every other surface uses, so a change to any of them
 * reaches this too (rules AJ, AL).
 *
 * **The filters it offers are the ones its reader may narrow by** (rule O). A
 * beneficiary is offered none: her calendar is already hers, and a branch or
 * level control would imply a scope she does not have — the server would refuse
 * to widen it anyway, so the control would be a lie. A مؤطرة is offered the
 * Subject, because she teaches several and *which class* is the question she
 * actually asks of her own week.
 *
 * **Cancelled occurrences never appear** (R83.1) — not filtered out here, but
 * absent from the read, which is what makes the rule true on every surface at
 * once rather than on each screen that remembers it.
 */
export function PersonalCalendar({
  token,
  fields = [],
  columns,
  heading,
}: {
  token: string | null;
  /** Which filters this reader may narrow by — see the note above. */
  fields?: readonly CalendarFilterField[];
  /** Which columns the list shows — the same authorization question (rule O). */
  columns: readonly OccurrenceColumn[];
  heading: string;
}): ReactNode {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [view, setView] = useState<CalendarView>(() => viewFromUrl('calendar'));
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [bootstrap, setBootstrap] = useState<CalendarBootstrap | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  /** The occurrence whose details are open — the same shared dialog the public
   *  calendar uses, which nothing but that page opened until now. */
  const [openEvent, setOpenEvent] = useState<Occurrence | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const filters = useCalendarFilters(fields);

  const from = iso(startOfMonth(month));
  const to = iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)));

  const load = useCallback(async () => {
    setState('loading');
    try {
      const rows = await fetchMyOccurrences({
        from,
        to,
        token,
        ...(filters.value.branchId ? { branchId: filters.value.branchId } : {}),
        ...(filters.value.categoryId ? { categoryId: filters.value.categoryId } : {}),
        ...(filters.value.levelId ? { levelId: filters.value.levelId } : {}),
        ...(filters.value.subjectId ? { subjectId: filters.value.subjectId } : {}),
        ...(filters.value.groupId ? { groupId: filters.value.groupId } : {}),
        ...(filters.value.circleId ? { circleId: filters.value.circleId } : {}),
        ...(filters.value.type ? { kind: filters.value.type } : {}),
      });
      setOccurrences(rows);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [
    from,
    to,
    token,
    filters.value.branchId,
    filters.value.categoryId,
    filters.value.levelId,
    filters.value.subjectId,
    filters.value.groupId,
    filters.value.circleId,
    filters.value.type,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // The Hijri overlay comes from the same bootstrap every other calendar
    // reads (R31–32): recorded Ministry announcements, never a computation.
    void fetchCalendarBootstrap({ from, to })
      .then(setBootstrap)
      .catch(() => setBootstrap(null));
  }, [from, to]);

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
    <section className="card" aria-labelledby="my-calendar-heading">
      <h2 id="my-calendar-heading">{heading}</h2>

      <CalendarHeader
        view={view}
        onView={setView}
        gregorianMonths={bootstrap?.gregorian_months ?? []}
        hijriMonths={bootstrap?.hijri.months ?? []}
        month={month}
        onPrevious={() => setMonth(addMonths(month, -1))}
        onToday={() => setMonth(startOfMonth(today))}
        onNext={() => setMonth(addMonths(month, 1))}
        // **Rendered in both views, always** — the property R84 exists for.
        filters={
          <CalendarFilters
            filters={filters}
            categories={bootstrap?.categories ?? []}
            levels={bootstrap?.levels ?? []}
            types={KINDS.map((k) => ({ value: k, label: t(`calendar.kind.${k}`) }))}
          />
        }
      />

      <div aria-live="polite" aria-busy={state === 'loading'}>
        {state === 'error' ? <p className="muted">{t('calendar.error')}</p> : null}
        {/* Nothing on the calendar is a real answer and says so, rather than
            rendering an empty grid a reader has to interpret. */}
        {state === 'ready' && occurrences.length === 0 ? (
          <p className="muted">{t('calendar.mineEmpty')}</p>
        ) : null}

        {view === 'calendar' ? (
          <CalendarGrid
            month={month}
            byDate={byDate}
            hijriByDate={hijriByDate}
            today={today}
            selected={openDay}
            onSelect={setOpenDay}
            onOpenEvent={setOpenEvent}
          />
        ) : (
          /* **The same table the public and back-office lists use** (R84):
             قائمة is a table everywhere, and the two views of this surface show
             the same month's occurrences under the same filters. */
          <OccurrenceTable
            occurrences={occurrences}
            columns={columns}
            status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'}
            onRetry={() => void load()}
            filtered={filters.active}
            onClearFilters={() => filters.clear()}
          />
        )}
      </div>

      {openDay ? (
        <DayEventsDialog
          date={openDay}
          occurrences={byDate.get(iso(openDay)) ?? []}
          hijri={hijriByDate.get(iso(openDay)) ?? null}
          onClose={() => setOpenDay(null)}
          onOpenEvent={setOpenEvent}
        />
      ) : null}

      {/**
        * **The SAME dialog the public calendar opens** (2026-08-20).
        *
        * Clicking an occurrence here did nothing at all: `onOpenEvent` was
        * `() => undefined` on both the grid and the day dialog, so a
        * beneficiary and a مؤطرة could see a class on their calendars and had
        * no way to ask anything about it. The component already existed and one
        * surface out of four used it.
        *
        * **What differs between surfaces is the caller, not the component**: it
        * reads the session's own details with the caller's token, so each
        * reader sees her own tier (§B6).
        */}
      <EventDetailsDialog
        occurrence={openEvent}
        // The occurrences carry their own branch names (TD-3.4 makes the
        // calendar self-sufficient), so the dialog needs no lookup table here.
        branchNames={new Map()}
        onClose={() => setOpenEvent(null)}
      />
    </section>
  );
}

/** The occurrence kinds a reader can narrow by — the platform's own taxonomy. */
const KINDS = ['session', 'event', 'exam'] as const;

const startOfMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const iso = (d: Date): string => d.toISOString().slice(0, 10);

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../adapters/branches.js';
import {
  fetchCalendarBootstrap,
  fetchOccurrences,
  type CalendarBootstrap,
  type HijriDay,
  type Occurrence,
} from '../adapters/calendar.js';
import { CalendarGrid } from '../components/calendar/calendar-grid.js';
import { CalendarHeader } from '../components/calendar/calendar-header.js';
import { OccurrenceTable } from '../components/calendar/occurrence-table.js';
import { viewFromUrl, type CalendarView } from '../components/calendar/view-switch.js';
import { CalendarFilters } from '../components/calendar/calendar-filters.js';
import { useCalendarFilters } from '../hooks/use-calendar-filters.js';
import { DayEventsDialog } from '../components/calendar/day-events-dialog.js';
import { EventDetailsDialog } from '../components/calendar/event-details-dialog.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { t } from '../i18n/index.js';
import { addMonths, endOfMonth, startOfMonth, toIsoDate } from '../lib/dates.js';
import { useSession } from '../contexts/session.js';

/**
 * `/calendar` — the public monthly calendar (§5.1, §4.4, TD-3.4, TD-3.10).
 *
 * The page is composition and state only: the grid, toolbar, title and dialogs
 * are their own components, and **all** data comes from the adapters. Nothing
 * here holds an event, a branch or a date literal.
 *
 * **Exactly two requests per view, never a third** (Revision 36): the bootstrap
 * for the screen's chrome — Hijri days, month metadata, categories, levels,
 * branches — and `/calendar` for the occurrences. Opening a day or an event
 * costs nothing further, because each occurrence is self-sufficient.
 *
 * Anonymous visitors get the public tier and the tier widens automatically once
 * signed in. The page sends the current credential but makes no visibility
 * decision of its own; the server remains the sole tier authority (§4.4).
 *
 * **The grid is the page.** It runs nearly the full viewport width and there is
 * no panel beneath it: a day opens in a dialog, which is what lets the cells be
 * tall enough to hold a real day's programme.
 */
type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; occurrences: Occurrence[] }
  | { kind: 'error' };

/**
 * What the **public** calendar filters by: the three scopes an anonymous visitor
 * may legitimately narrow. No subject and no type — a visitor is choosing where
 * and for whom, not inspecting the schedule's internals.
 */
/**
 * **The public set** — branch, category, level, subject and type.
 *
 * Every option comes from data that is **already public**: `GET /branches` is
 * the §5.1 landing directory and the calendar bootstrap's categories and levels
 * are anonymous reads (TD-3.10). Nothing internal is exposed to populate a
 * control, and the page stays the same for everybody — a filter narrows what a
 * visitor sees of the public timetable; it never personalises it.
 */
const PUBLIC_FILTER_FIELDS = ['branchId', 'categoryId', 'levelId', 'subjectId', 'type'] as const;

export function CalendarPage(): ReactNode {
  const { accessToken } = useSession();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  /**
   * **The same filter state the back office uses** (2026-08-19).
   *
   * It held three `useState`s of its own, which worked — this surface renders
   * both views from ONE `occurrences` array, so it never had the back office's
   * defect. Sharing the hook is not a fix here; it is what stops the two
   * surfaces drifting, and it moves the filters into the URL, so a filtered
   * calendar is now a link somebody can send.
   */
  const filters = useCalendarFilters(PUBLIC_FILTER_FIELDS);
  const branchId = filters.value.branchId ?? null;
  const categoryId = filters.value.categoryId ?? null;
  const levelId = filters.value.levelId ?? null;
  /** المادة — read here so it is both SENT and in the effect's dependencies. */
  const subjectId = filters.value.subjectId ?? null;
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [bootstrap, setBootstrap] = useState<CalendarBootstrap | null>(null);
  const [bootstrapBusy, setBootstrapBusy] = useState(true);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [openDay, setOpenDay] = useState<Date | null>(null);
  /** `calendar` is the public default: the month grid is what §5.1 links to. */
  const [view, setView] = useState<CalendarView>(() => viewFromUrl('calendar'));
  const [openEvent, setOpenEvent] = useState<Occurrence | null>(null);
  /** Prefilling happens once per visit, not once per fetch — see the effect. */
  const prefillApplied = useRef(false);

  const from = toIsoDate(startOfMonth(month));
  const to = toIsoDate(endOfMonth(month));

  // The branch directory is independent of the month and of every filter, so it
  // is fetched once. (The bootstrap also carries branches; this adapter is kept
  // because it is what the landing page uses and it carries contact details the
  // bootstrap deliberately does not.)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchBranches();
        if (!cancelled) setBranches(rows);
      } catch {
        // A failed branch list costs the filter, not the calendar.
        if (!cancelled) setBranches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The chrome. Re-requested when the month changes (different Hijri days and
   * month metadata) and when the category changes — the latter because §4.4
   * requires the Level list to be narrowed **server-side**, so selecting a
   * category is a request, not a local filter.
   */
  useEffect(() => {
    let cancelled = false;
    setBootstrapBusy(true);
    void (async () => {
      try {
        const next = await fetchCalendarBootstrap({ from, to, categoryId });
        if (!cancelled) setBootstrap(next);
      } catch {
        // Losing the chrome costs the Hijri overlay and the filters, not the
        // grid: the occurrences render regardless, which is the more important
        // half of the screen.
        if (!cancelled) setBootstrap(null);
      } finally {
        if (!cancelled) setBootstrapBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, categoryId]);

  /** The occurrences. Every filter narrows them server-side (TD-3.4). */
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        const result = await fetchOccurrences({
          from,
          to,
          token: accessToken,
          branchId,
          categoryId,
          levelId,
          subjectId,
          ...(filters.value.type ? { kind: filters.value.type } : {}),
        });
        if (cancelled) return;
        setLoad({ kind: 'ready', occurrences: result.occurrences });

        // TD-3.4 (R43): the server derives `prefilled_filters` from the live
        // profile, and the caller may change any of them. **Applied once**, on
        // the first response, and only to filters the reader has not already
        // set — re-applying on every fetch would drag a filter back the moment
        // someone cleared it, which is the opposite of "freely changeable".
        //
        // It is a suggestion, not a scope: the server does not narrow results by
        // it, and neither does this.
        if (!prefillApplied.current && result.prefilled) {
          prefillApplied.current = true;
          const p = result.prefilled;
          // The server's prefilled filters seed the state only where the reader
          // has chosen nothing — a choice already made is never overwritten.
          if (p.branch_id && branchId === null) filters.set('branchId', p.branch_id);
          if (p.category_id && categoryId === null) filters.set('categoryId', p.category_id);
          if (p.level_id && levelId === null) filters.set('levelId', p.level_id);
        }
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  /**
   * **`subjectId` belongs in this list** (UAT, 2026-09-02). Without it the
   * request carried the new value only when some OTHER dependency changed —
   * the same silent-filter failure `sort` had on طلبات الانضمام: the control
   * looks alive and the results simply never move.
   */
  }, [from, to, branchId, categoryId, levelId, subjectId, filters.value.type, accessToken]);

  const occurrences = load.kind === 'ready' ? load.occurrences : [];

  /** Resolved once from the directory the page already holds — a fallback for
   *  the branch name, which Revision 36 now puts on the occurrence itself. */
  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  /** One pass, so neither the grid nor the dialogs re-scan the list per day. */
  const byDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.date);
      if (list) list.push(occurrence);
      else map.set(occurrence.date, [occurrence]);
    }
    // Within a day, earliest first; untimed items last, since "all day" has no
    // position in a sequence of clock times.
    for (const list of map.values()) {
      list.sort((a, b) => (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99'));
    }
    return map;
  }, [occurrences]);

  /** Recorded official Hijri days, keyed for O(1) lookup per cell. */
  const hijriByDate = useMemo(() => {
    const map = new Map<string, HijriDay>();
    for (const day of bootstrap?.hijri.days ?? []) map.set(day.date, day);
    return map;
  }, [bootstrap]);

  /**
   * Navigation changes the month and nothing else — **every active filter is
   * preserved**, because the filters are independent state and nothing here
   * touches them.
   *
   * `اليوم` returns to the current month, where today's cell is already marked.
   * It deliberately does **not** open the day dialog: pressing a navigation
   * button should move the view, not launch a modal over it.
   */
  function goToMonth(next: Date): void {
    setMonth(startOfMonth(next));
    // A day dialog left open would describe a day the grid no longer shows.
    setOpenDay(null);
  }

  /* **Changing category resets the level** — the rule this page used to own in
     `changeCategory`, and which now lives in `useCalendarFilters` so every
     surface gets it. The previous Level almost certainly belongs to the Category
     just left, and keeping it filters the grid to nothing while both selects
     look perfectly reasonable (§4.4b). */

  return (
    <>
      <ApplicationHeader />
      <main id="main">
        <section className="section cal-page" aria-labelledby="calendar-title">
          {/* Deliberately NOT wrapped in the standard Container: the grid wants
              nearly the full viewport width, which is the whole point of a
              timetable. `cal-page__inner` sets its own wider bound. */}
          <div className="cal-page__inner">
            {/* The reading order the page is built around: what month am I
                looking at → how do I move → what am I filtering → the grid. */}
            <div className="cal-page__head">
              <h1 id="calendar-title" className="cal-page__eyebrow">
                {t('calendar.title')}
              </h1>
            </div>

            {/* **The one calendar header** — switch right, dual title centred,
                stepping left, filters on their own row. The arrangement lives in
                the component so the back office cannot drift from it, which is
                exactly what had happened. */}
            <CalendarHeader
              view={view}
              onView={setView}
              gregorianMonths={bootstrap?.gregorian_months ?? []}
              hijriMonths={bootstrap?.hijri.months ?? []}
              month={month}
              onPrevious={() => goToMonth(addMonths(month, -1))}
              onToday={() => goToMonth(today)}
              onNext={() => goToMonth(addMonths(month, 1))}
              filters={
                <CalendarFilters
                  filters={filters}
                  branches={branches}
                  subjects={bootstrap?.subjects ?? []}
                  categories={bootstrap?.categories ?? []}
                  levels={bootstrap?.levels ?? []}
                  levelsBusy={bootstrapBusy}
                  types={[
                    { value: 'session', label: t('calendar.kind.session') },
                    { value: 'event', label: t('calendar.kind.event') },
                    { value: 'exam', label: t('calendar.kind.exam') },
                  ]}
                />
              }
            />

            {/* Announced politely so a keyboard user hears the month reload
                rather than watching a grid redraw in silence (§14.4). */}
            <div aria-live="polite" aria-busy={load.kind === 'loading'}>
              {load.kind === 'error' ? <p className="muted">{t('calendar.error')}</p> : null}

              {view === 'calendar' ? (
                <>
                  <CalendarGrid
                    month={month}
                    byDate={byDate}
                    hijriByDate={hijriByDate}
                    today={today}
                    selected={openDay}
                    onSelect={setOpenDay}
                    onOpenEvent={setOpenEvent}
                  />

                  {load.kind === 'ready' && occurrences.length === 0 ? (
                    <p className="muted cal-page__empty">{t('calendar.monthEmpty')}</p>
                  ) : null}
                </>
              ) : (
                /* **The same occurrences, as a table** (R84). No second fetch
                   and no second projection — the §4.4 tiers have already decided
                   what is in this array, so the list cannot widen them — and it
                   is now the platform's `DataTable` rather than this page's own
                   markup, so it has the empty, error and retry states the
                   hand-rolled list never had.

                   **No room, no teacher, no actions**: a public visitor reads
                   what is on and for whom, not who is teaching it or where in
                   the building. */
                <OccurrenceTable
                  occurrences={occurrences}
                  columns={['kind', 'title', 'date', 'time', 'level', 'subject', 'branch']}
                  // `DataTable` derives *empty* from the rows themselves; the
                  // status says only how the fetch went.
                  status={
                    load.kind === 'loading' ? 'loading' : load.kind === 'error' ? 'error' : 'ready'
                  }
                  onRetry={() => setMonth(new Date(month))}
                  filtered={filters.active}
                  onClearFilters={() => filters.clear()}
                />
              )}
            </div>
          </div>
        </section>
      </main>

      <DayEventsDialog
        date={openDay}
        hijri={openDay ? (hijriByDate.get(toIsoDate(openDay)) ?? null) : null}
        occurrences={openDay ? (byDate.get(toIsoDate(openDay)) ?? []) : []}
        onClose={() => setOpenDay(null)}
        onOpenEvent={setOpenEvent}
      />
      <EventDetailsDialog
        occurrence={openEvent}
        branchNames={branchNames}
        onClose={() => setOpenEvent(null)}
      />
      <SiteFooter />
    </>
  );
}

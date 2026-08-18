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
import { OccurrenceList } from '../components/calendar/occurrence-list.js';
import { viewFromUrl, type CalendarView } from '../components/calendar/view-switch.js';
import { CalendarToolbar } from '../components/calendar/calendar-toolbar.js';
import { DayEventsDialog } from '../components/calendar/day-events-dialog.js';
import { EventDetailsDialog } from '../components/calendar/event-details-dialog.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { t } from '../i18n/index.js';
import { addMonths, endOfMonth, startOfMonth, toIsoDate } from '../lib/dates.js';

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
 * signed in — that decision is the server's (§4.4), so this page does not branch
 * on the session at all.
 *
 * **The grid is the page.** It runs nearly the full viewport width and there is
 * no panel beneath it: a day opens in a dialog, which is what lets the cells be
 * tall enough to hold a real day's programme.
 */
type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; occurrences: Occurrence[] }
  | { kind: 'error' };

export function CalendarPage(): ReactNode {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [branchId, setBranchId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [levelId, setLevelId] = useState<string | null>(null);
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
        const result = await fetchOccurrences({ from, to, branchId, categoryId, levelId });
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
          if (p.branch_id && branchId === null) setBranchId(p.branch_id);
          if (p.category_id && categoryId === null) setCategoryId(p.category_id);
          if (p.level_id && levelId === null) setLevelId(p.level_id);
        }
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, branchId, categoryId, levelId]);

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

  /** Changing category **resets the level**: the previous level almost certainly
   *  belongs to the category just left, and keeping it would filter the grid to
   *  nothing while both selects looked reasonable. */
  function changeCategory(next: string | null): void {
    setCategoryId(next);
    setLevelId(null);
  }

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
                <CalendarToolbar
                  branches={branches}
                  branchId={branchId}
                  onBranchChange={setBranchId}
                  categories={bootstrap?.categories ?? []}
                  categoryId={categoryId}
                  onCategoryChange={changeCategory}
                  levels={bootstrap?.levels ?? []}
                  levelId={levelId}
                  levelsBusy={bootstrapBusy}
                  onLevelChange={setLevelId}
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
                /* **The same occurrences, read as a sequence.** No second fetch
                   and no second projection — the §4.4 tiers have already decided
                   what is in this array, so the list cannot widen them. */
                <OccurrenceList occurrences={occurrences} onOpen={setOpenEvent} />
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

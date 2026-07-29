import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchBranches, type PublicBranch } from '../adapters/branches.js';
import { fetchOccurrences, type Occurrence } from '../adapters/calendar.js';
import { CalendarGrid } from '../components/calendar/calendar-grid.js';
import { CalendarSidebar } from '../components/calendar/calendar-sidebar.js';
import { CalendarToolbar } from '../components/calendar/calendar-toolbar.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { SiteFooter } from '../components/site-footer.js';
import { Container } from '../components/ui/container.js';
import { t } from '../i18n/index.js';
import { addMonths, endOfMonth, startOfMonth, toIsoDate } from '../lib/dates.js';

/**
 * `/calendar` — the public monthly calendar (§5.1, §4.4, TD-3.4).
 *
 * The page is composition and state only: the grid, toolbar and panels are
 * their own components, and **all** data comes from the adapters. Nothing here
 * holds an event, a branch or a date literal.
 *
 * Anonymous visitors get the public tier and the tier widens automatically once
 * signed in — that decision is the server's (§4.4), so this page does not
 * branch on the session at all.
 */
type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; occurrences: Occurrence[] }
  | { kind: 'error' };

export function CalendarPage(): ReactNode {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState<Date>(today);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  // The branch list is independent of the month, so it is fetched once rather
  // than on every navigation.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchBranches();
        if (!cancelled) setBranches(rows);
      } catch {
        // A failed branch list costs the filter, not the calendar; the grid
        // still renders every branch's occurrences.
        if (!cancelled) setBranches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const from = toIsoDate(startOfMonth(month));
  const to = toIsoDate(endOfMonth(month));

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        const rows = await fetchOccurrences({ from, to, branchId });
        if (!cancelled) setLoad({ kind: 'ready', occurrences: rows });
      } catch {
        if (!cancelled) setLoad({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, branchId]);

  const occurrences = load.kind === 'ready' ? load.occurrences : [];

  /** One pass, so neither the grid nor the panels re-scan the list per day. */
  const byDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.date);
      if (list) list.push(occurrence);
      else map.set(occurrence.date, [occurrence]);
    }
    return map;
  }, [occurrences]);

  function goToMonth(next: Date): void {
    setMonth(startOfMonth(next));
    // Selecting the 1st keeps the panel in the month being viewed; leaving the
    // old selection would show a day the grid no longer displays.
    setSelected(startOfMonth(next));
  }

  return (
    <>
      <ApplicationHeader />
      <main id="main">
        <section className="section cal-page" aria-labelledby="calendar-title">
          <Container>
            <div className="section__head">
              <h1 id="calendar-title" className="section__title">
                {t('calendar.title')}
              </h1>
              <p className="lede">{t('calendar.lede')}</p>
            </div>

            <CalendarToolbar
              branches={branches}
              branchId={branchId}
              onBranchChange={setBranchId}
              month={month}
              onPrevious={() => goToMonth(addMonths(month, -1))}
              onNext={() => goToMonth(addMonths(month, 1))}
              onToday={() => {
                setMonth(startOfMonth(today));
                setSelected(today);
              }}
            />

            {/* Announced politely so a keyboard user hears the month reload
                rather than watching a grid redraw in silence (§14.4). */}
            <div aria-live="polite" aria-busy={load.kind === 'loading'}>
              {load.kind === 'error' ? <p className="muted">{t('calendar.error')}</p> : null}

              <div className="cal-layout">
                <div className="cal-layout__grid">
                  <CalendarGrid
                    month={month}
                    byDate={byDate}
                    today={today}
                    selected={selected}
                    onSelect={setSelected}
                  />
                  {load.kind === 'ready' && occurrences.length === 0 ? (
                    <p className="muted cal-page__empty">{t('calendar.monthEmpty')}</p>
                  ) : null}
                </div>

                <CalendarSidebar
                  selectedDate={selected}
                  selectedOccurrences={byDate.get(toIsoDate(selected)) ?? []}
                  occurrences={occurrences}
                  today={toIsoDate(today)}
                />
              </div>
            </div>
          </Container>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

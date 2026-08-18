import type { ReactNode } from 'react';

import type { GregorianMonthRef, HijriMonthRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { CalendarNav } from './calendar-nav.js';
import { CalendarTitle } from './calendar-title.js';
import { ViewSwitch, type CalendarView } from './view-switch.js';

/**
 * **One calendar header, for every calendar surface.**
 *
 * The three atoms existed and were shared; the *arrangement* was not, and that is
 * where the two surfaces had already diverged. The public calendar put the title
 * above a controls row; the back office put the title beside the stepping in a
 * `.cal-toolbar` — the FILTERS container — and its view switch somewhere else on
 * the page entirely. Two readings of the same screen, and a third surface would
 * have invented a fourth.
 *
 * The layout, in RTL reading order:
 *
 *     ┌──────────────────────────────────────────────────────────┐
 *     │ [قائمة | تقويم]     صفر 1448 │ أغسطس 2026     [السابق | اليوم | التالي] │
 *     ├──────────────────────────────────────────────────────────┤
 *     │ filters (optional)                                        │
 *     └──────────────────────────────────────────────────────────┘
 *
 * **The title is centred on the HEADER, not in the space left over.** The row is
 * a `1fr auto 1fr` grid: both side columns take the same width whatever their
 * contents measure, so the middle sits on the header's centre line. A flex row
 * with `justify-content: space-between` — the obvious alternative — centres the
 * title only when the two control groups happen to be the same width, and they
 * never are: «السابق اليوم التالي» is three controls against two, and hiding the
 * stepping in the list view changes it again.
 *
 * **No date arithmetic lives here.** The Gregorian and Hijri month names come
 * from the backend's bootstrap through `CalendarTitle`, which is the only place
 * that formats them (§20 rule 14; R31, R36). This component decides position and
 * nothing else — the page still owns its data, its filters and what a step means.
 */
export function CalendarHeader({
  view,
  onView,
  gregorianMonths = [],
  hijriMonths = [],
  month,
  onPrevious,
  onToday,
  onNext,
  filters,
}: {
  view: CalendarView;
  onView: (view: CalendarView) => void;
  gregorianMonths?: GregorianMonthRef[];
  hijriMonths?: HijriMonthRef[];
  /**
   * The month on screen, or nothing.
   *
   * **Absent means this surface has no month context**, and the centre and the
   * stepping are then omitted together — the back office's list is a table of
   * recurring schedules, not a month, and naming a month above it would assert a
   * scope the list does not have. Deriving it from the data the caller already
   * passes beats a `showTitle` flag: a behaviour each caller must opt into is a
   * behaviour that will be missing somewhere (rule AE).
   */
  month?: Date;
  onPrevious?: () => void;
  onToday?: () => void;
  onNext?: () => void;
  /**
   * The filter row, or nothing.
   *
   * A slot rather than a fixed set of selectors: the public calendar filters by
   * branch, category and level, and the back office does not filter at all. A
   * surface with no filters simply omits the row — it does not render an empty
   * one, which would state that filters exist and are missing.
   */
  filters?: ReactNode;
}): ReactNode {
  return (
    <div className="cal-header">
      <div className="cal-header__bar">
        {/* Source order IS the RTL visual order: first column reads right. */}
        <div className="cal-header__start">
          <ViewSwitch view={view} onView={onView} />
        </div>
        <div className="cal-header__centre">
          {month ? (
            <CalendarTitle
              gregorianMonths={gregorianMonths}
              hijriMonths={hijriMonths}
              month={month}
            />
          ) : null}
        </div>
        <div className="cal-header__end">
          {/* Stepping a month is meaningless in the list view — the list is not
              month-shaped — so the control is absent rather than inert. The grid
              keeps the title centred either way, which is the point of the
              1fr auto 1fr row. */}
          {month && view === 'calendar' && onPrevious && onToday && onNext ? (
            <CalendarNav onPrevious={onPrevious} onToday={onToday} onNext={onNext} />
          ) : null}
        </div>
      </div>

      {filters ? (
        <div className="cal-header__filters" role="group" aria-label={t('calendar.filtersLabel')}>
          {filters}
        </div>
      ) : null}
    </div>
  );
}

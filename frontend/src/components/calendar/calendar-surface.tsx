import type { ReactNode } from 'react';

import { CalendarHeader } from './calendar-header.js';
import type { CalendarView } from './view-switch.js';
import type { GregorianMonthRef, HijriMonthRef } from '../../adapters/calendar.js';

/**
 * **One chrome for every calendar in the platform** (R84 contract, rule AO).
 *
 * Each surface used to compose its own controls, and the differences were
 * accidents rather than decisions: the back office rendered its filters inside
 * the list's table toolbar, so **switching to تقويم made the whole filter
 * section disappear** while its values quietly survived in the URL. The public
 * page put them in the header slot. The beneficiary had none at all.
 *
 * What varies between surfaces is genuinely two things, and they are stated as
 * data rather than rebuilt per page:
 *
 * | | month controls | filters | content |
 * |---|---|---|---|
 * | month-scoped views | yes | the surface's set | occurrences |
 * | the back office's **list** | **no** | the same set | definitions |
 *
 * **The back office's list is not month-scoped**, and that is the only reason it
 * differs: it lists every matching schedule and event *definition*, so a month
 * title and a السابق/اليوم/التالي would be controls that mean nothing. Every
 * other view — including its own calendar, and both views of the public,
 * beneficiary and مؤطرة surfaces — reads occurrences **for a month** and keeps
 * them.
 *
 * **The filter section never depends on the view.** That is the property this
 * component exists to make structural rather than remembered: `filters` is
 * rendered above the content on every surface, in both views, always.
 */
export function CalendarSurface({
  view,
  onView,
  monthScoped,
  month,
  gregorianMonths,
  hijriMonths,
  onPrevious,
  onToday,
  onNext,
  filters,
  children,
}: {
  view: CalendarView;
  onView: (next: CalendarView) => void;
  /**
   * Whether **this view** is month-scoped.
   *
   * A fact about the view's data, not a preference: the back office's list
   * shows definitions and is `false`; everything else is `true`. Passing it
   * per view rather than per surface is what lets one surface be both.
   */
  monthScoped: boolean;
  month: Date;
  gregorianMonths?: GregorianMonthRef[];
  hijriMonths?: HijriMonthRef[];
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  /** The filter row — rendered in EVERY view. See the note above. */
  filters: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <CalendarHeader
        view={view}
        onView={onView}
        // **The month half is what `monthScoped` withholds**, and it withholds
        // it by passing no month at all: `CalendarHeader` already omits the
        // title and the stepping together when there is no month (R82's
        // shape-follows-data rule), so nothing here needs a second flag.
        {...(monthScoped
          ? {
              month,
              gregorianMonths: gregorianMonths ?? [],
              hijriMonths: hijriMonths ?? [],
              onPrevious,
              onToday,
              onNext,
            }
          : {})}
        filters={filters}
      />
      {children}
    </>
  );
}

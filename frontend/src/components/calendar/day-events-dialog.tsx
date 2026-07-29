import type { ReactNode } from 'react';

import type { HijriDay, Occurrence } from '../../adapters/calendar.js';
import { toIsoDate } from '../../lib/dates.js';
import { t, tList } from '../../i18n/index.js';
import { Dialog } from '../ui/dialog.js';

/**
 * Every activity on one day, **listed in full rather than collapsed**.
 *
 * This replaces the panel that used to sit beneath the grid. A dialog is the
 * right shape for the same reason the event details are one: the grid now claims
 * the page's width and most of its height, so anything below it opens off-screen
 * and turns every click into a scroll.
 *
 * **Nothing here is truncated or summarised.** The day cell is the compact view;
 * this is the complete one, which is what makes the cell's compactness
 * affordable. Each row shows the time, the title, and the context a reader needs
 * to tell two similarly-named sessions apart — then opens the full details on
 * click.
 *
 * The heading carries **both calendars**, using the same colours as the grid, and
 * omits the Hijri side entirely when the month has not been recorded and
 * published (Revision 31).
 */
export function DayEventsDialog({
  date,
  hijri,
  occurrences,
  onClose,
  onOpenEvent,
}: {
  date: Date | null;
  hijri: HijriDay | null;
  occurrences: Occurrence[];
  onClose: () => void;
  onOpenEvent: (occurrence: Occurrence) => void;
}): ReactNode {
  const months = tList('calendar.months');
  const gregorian = date
    ? `${date.getDate()} ${months[date.getMonth()] ?? ''} ${date.getFullYear()}`
    : '';
  const hijriLabel =
    hijri?.hijri_day != null && hijri.hijri_month_ar
      ? `${hijri.hijri_day} ${hijri.hijri_month_ar} ${hijri.hijri_year ?? ''}`.trim()
      : null;

  return (
    <Dialog open={date !== null} onClose={onClose} title={t('calendar.dayDialogTitle')} wide>
      {date ? (
        <>
          <p className="cal-daydialog__date">
            <time className="cal-daydialog__gregorian" dateTime={toIsoDate(date)}>
              {gregorian}
            </time>
            {hijriLabel ? (
              <>
                <span className="cal-daydialog__divider" aria-hidden="true" />
                <span className="cal-daydialog__hijri">{hijriLabel}</span>
              </>
            ) : null}
          </p>

          {occurrences.length === 0 ? (
            <p className="muted">{t('calendar.selectedDayEmpty')}</p>
          ) : (
            <ul className="cal-daydialog__list">
              {occurrences.map((occurrence) => (
                <li key={`${occurrence.kind}-${occurrence.id}`}>
                  <button
                    type="button"
                    className={`cal-dayrow cal-dayrow--${occurrence.kind}`}
                    onClick={() => onOpenEvent(occurrence)}
                  >
                    <span className="cal-dayrow__time" dir="ltr">
                      {occurrence.start_time
                        ? `${occurrence.start_time}${occurrence.end_time ? ` — ${occurrence.end_time}` : ''}`
                        : t('calendar.allDay')}
                    </span>
                    <span className="cal-dayrow__body">
                      <span className="cal-dayrow__title">{occurrence.title}</span>
                      {/* Only what the backend actually sent, joined so the row
                          stays one line on a phone. A field with no value is
                          absent, never an empty separator. */}
                      <span className="cal-dayrow__meta">
                        {[
                          occurrence.level_name,
                          occurrence.branch_name,
                          occurrence.room_name,
                          occurrence.instructors.map((i) => i.display_name).join('، ') || null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="visually-hidden">{t('calendar.openDetails')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </Dialog>
  );
}

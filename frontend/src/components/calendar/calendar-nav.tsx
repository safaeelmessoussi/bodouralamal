import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';

/**
 * Month navigation: **three buttons, no month label.**
 *
 *     السابق        اليوم        التالي
 *
 * The label lives in the dual-calendar title above, which is the one place the
 * month is named — the previous control carried its own copy of the Gregorian
 * month beside the title's, which is two renderings of one fact and the sort of
 * duplication this project removes rather than syncs.
 *
 * **`اليوم` is the primary variant** and the other two are secondary: returning
 * to today is the action a visitor most often wants and the only one that is not
 * reversible by pressing the opposite button, so it earns the emphasis.
 *
 * **Labels are short and accessible names are long.** The visible text is
 * `السابق`, while the accessible name is `الشهر السابق` — "previous" alone is
 * ambiguous when announced out of context. The long name *contains* the visible
 * text, which is what keeps voice control working (WCAG 2.5.3 Label in Name):
 * a user saying "السابق" still matches.
 *
 * Navigation is instantaneous and **preserves every active filter**, because the
 * page holds the filters as state independent of the month — pressing a button
 * changes one value and nothing resets.
 */
export function CalendarNav({
  onPrevious,
  onToday,
  onNext,
}: {
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
}): ReactNode {
  return (
    <nav className="cal-nav" aria-label={t('calendar.navLabel')}>
      <Button variant="secondary" onClick={onPrevious} aria-label={t('calendar.previousMonth')}>
        {t('calendar.navPrevious')}
      </Button>
      <Button variant="primary" onClick={onToday}>
        {t('calendar.today')}
      </Button>
      <Button variant="secondary" onClick={onNext} aria-label={t('calendar.nextMonth')}>
        {t('calendar.navNext')}
      </Button>
    </nav>
  );
}

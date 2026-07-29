import type { ReactNode } from 'react';

import { t, tList } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { Icon } from '../ui/icon.js';

/**
 * Month navigation: previous, the current month as a heading, next, and Today.
 *
 * The month name is an `<output>` with `aria-live="polite"` so a keyboard user
 * who steps through months hears where they landed — otherwise the only
 * feedback is a grid silently redrawing.
 *
 * The chevrons are **not** mirrored in markup: `dir="rtl"` already reverses the
 * visual order of the buttons, so "previous" sits where a reader of Arabic
 * expects it.
 */
export function MonthSelector({
  month,
  onPrevious,
  onNext,
  onToday,
}: {
  month: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}): ReactNode {
  const months = tList('calendar.months');
  const label = `${months[month.getMonth()] ?? ''} ${month.getFullYear()}`;

  return (
    <div className="month-selector">
      <Button variant="secondary" onClick={onPrevious} aria-label={t('calendar.previousMonth')}>
        <Icon name="chevron" size={18} />
      </Button>

      <output className="month-selector__label" aria-live="polite">
        {label}
      </output>

      <Button variant="secondary" onClick={onNext} aria-label={t('calendar.nextMonth')}>
        <Icon name="chevron" size={18} />
      </Button>

      <Button variant="ghost" onClick={onToday}>
        {t('calendar.today')}
      </Button>
    </div>
  );
}

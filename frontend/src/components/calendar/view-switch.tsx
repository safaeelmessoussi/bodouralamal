import { type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';

/**
 * **قائمة / تقويم — one switch, wherever a calendar is read.**
 *
 * It was inline markup inside `scheduling.tsx`. Copying it onto the public
 * calendar would have made two, and the second would have drifted the first time
 * either changed — the platform's own rule (constitution §2.1, ux-architecture
 * rule C) is one component per *concept*, and *which view of a calendar am I
 * looking at* is one concept whoever is asking.
 *
 * **The view is a query parameter, not a navigation node** (§20 rule 16), which
 * is what makes a chosen view survive a reload and a shared link — the same
 * choice §5.2's library made for its two views.
 */
export type CalendarView = 'list' | 'calendar';

/** Reads the view from the URL, defaulting to the one the screen prefers. */
export function viewFromUrl(fallback: CalendarView): CalendarView {
  return new URLSearchParams(window.location.search).get('view') === (fallback === 'list' ? 'calendar' : 'list')
    ? fallback === 'list'
      ? 'calendar'
      : 'list'
    : fallback;
}

export function ViewSwitch({
  view,
  onView,
}: {
  view: CalendarView;
  onView: (next: CalendarView) => void;
}): ReactNode {
  return (
    /* The SAME segmented shell the month stepping uses, so every calendar
       surface reads as one control system rather than as five buttons. It sat on
       `.cal-toolbar` — the FILTERS class — which is why it inherited their size
       and spacing. */
    <div className="cal-segmented" role="tablist" aria-label={t('scheduling.viewLabel')}>
      {(['list', 'calendar'] as const).map((v) => (
        <Button
          key={v}
          variant="ghost"
          className={view === v ? 'is-active' : undefined}
          role="tab"
          aria-selected={view === v}
          onClick={() => {
            onView(v);
            const url = new URL(window.location.href);
            url.searchParams.set('view', v);
            window.history.replaceState(null, '', url);
          }}
        >
          {t(`scheduling.view.${v}`)}
        </Button>
      ))}
    </div>
  );
}

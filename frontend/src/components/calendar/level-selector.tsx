import type { ReactNode } from 'react';

import type { LevelRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';

/**
 * Level filter, **dependent on the selected category**.
 *
 * The list it renders is whatever the bootstrap returned. When a category is
 * selected the page re-requests the bootstrap with `category_id`, and the server
 * returns only that category's levels — **the narrowing happens server-side by
 * rule**, because §4.4 requires it *"so the client never filters a list it was
 * handed"*. This component therefore contains no filtering logic at all, which
 * is the point: there is nothing here to get wrong.
 *
 * `busy` marks the moment between changing category and the narrowed list
 * arriving. The control is disabled rather than hidden, so the row does not
 * reflow and the user can see what is happening.
 *
 * Level numbering is **not uniform across categories** (§4.4b — no category is
 * guaranteed a level 0), which is another reason the names are rendered as given
 * rather than derived from an index.
 */
export function LevelSelector({
  levels,
  value,
  busy,
  onChange,
}: {
  levels: LevelRef[];
  value: string | null;
  busy: boolean;
  onChange: (levelId: string | null) => void;
}): ReactNode {
  return (
    <div className="cal-filter">
      <label className="cal-filter__label" htmlFor="level-filter">
        {t('calendar.levelLabel')}
      </label>
      <select
        id="level-filter"
        className="cal-filter__control"
        value={value ?? ''}
        disabled={busy || levels.length === 0}
        aria-busy={busy}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('calendar.allLevels')}</option>
        {levels.map((level) => (
          <option key={level.id} value={level.id}>
            {level.name}
          </option>
        ))}
      </select>
    </div>
  );
}

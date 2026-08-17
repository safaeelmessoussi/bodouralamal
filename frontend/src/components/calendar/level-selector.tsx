import type { ReactNode } from 'react';

import type { CategoryRef, LevelRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { LevelSelect, withCategoryNames } from '../scope/level-select.js';

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
 * ## It renders `{Category} — {Level}` now, and here is why it did not
 *
 * This component argued that the Category prefix was unnecessary because the
 * list is category-narrowed server-side. **That is only true once a Category has
 * been chosen** — and `الكل` is the calendar's default, so the common case was a
 * list spanning every Category with bare names. §4.4b is explicit that Level
 * names are not unique across Categories, so *فرصة أمل* could appear twice with
 * nothing to tell the two apart.
 *
 * So it composes the shared `LevelSelect` and passes the Category names the
 * bootstrap **already returns in the same payload**. Once a Category is chosen
 * the prefix is redundant rather than wrong — one repeated word is a far smaller
 * cost than an ambiguous option, and a label that changes shape depending on a
 * sibling control is a third variant of the format the platform has exactly one
 * of.
 *
 * Level numbering is **not uniform across categories** (§4.4b — no category is
 * guaranteed a level 0), which is another reason the names are rendered as given
 * rather than derived from an index.
 */
export function LevelSelector({
  levels,
  categories,
  value,
  busy,
  onChange,
}: {
  levels: LevelRef[];
  /** From the same bootstrap payload as `levels`, purely to complete the label. */
  categories: CategoryRef[];
  value: string | null;
  busy: boolean;
  onChange: (levelId: string | null) => void;
}): ReactNode {
  return (
    <LevelSelect
      label={t('calendar.levelLabel')}
      levels={withCategoryNames(levels, categories)}
      value={value}
      onChange={(next) => onChange(next === '' ? null : next)}
      placeholder={t('calendar.allLevels')}
      busy={busy}
      disabled={levels.length === 0}
    />
  );
}

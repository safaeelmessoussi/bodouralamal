import type { ReactNode } from 'react';

import type { LevelRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { SelectField } from '../ui/field.js';

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
  // Built on the shared `SelectField` (Revision 39) — generated id, and `busy`
  // is the primitive's own concern now rather than this file's.
  return (
    <SelectField
      label={t('calendar.levelLabel')}
      value={value ?? ''}
      onChange={(next) => onChange(next === '' ? null : next)}
      placeholder={t('calendar.allLevels')}
      options={levels.map((level) => ({ value: level.id, label: level.name }))}
      busy={busy}
      disabled={levels.length === 0}
    />
  );
}

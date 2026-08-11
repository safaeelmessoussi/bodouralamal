import type { ReactNode } from 'react';

import type { ContentItem } from '../../adapters/content.js';
import { t, tList } from '../../i18n/index.js';
import { formatDate } from '../../lib/format-date.js';
import { Icon, type IconName } from '../ui/icon.js';

/**
 * One educational resource, compact.
 *
 * A `<button>`, not a card with a link inside: opening the item is the only
 * action, so the whole card is the control — which also gives the browser a
 * focus target to return to when the preview dialog closes.
 *
 * **Fields the backend did not send are absent, not blank.** An empty row claims
 * the value *is* empty, which is a different statement from "not recorded" — the
 * same rule the calendar's event dialog follows.
 *
 * The teacher name is rendered **verbatim**: the backend already resolved which
 * name is public (§7's Public display identity invariant), and this type carries
 * no other name field, so there is nothing here to choose between (§20 rule 21).
 */
export function ContentCard({
  item,
  onOpen,
}: {
  item: ContentItem;
  onOpen: (item: ContentItem) => void;
}): ReactNode {
  const kindLabel = t(`content.kind.${item.kind}`);
  return (
    <li className="content-card__wrap">
      <button
        type="button"
        className={`content-card content-card--${item.kind}`}
        onClick={() => onOpen(item)}
      >
        {/* Decorative: the accessible name comes from the text below, and the
            kind is stated in words as well as by icon — colour and shape alone
            never carry meaning. */}
        <span className="content-card__icon" aria-hidden="true">
          <Icon name={ICONS[item.kind]} size={22} />
        </span>

        <span className="content-card__body">
          <span className="content-card__title">{item.title}</span>

          {item.description ? (
            <span className="content-card__description">{item.description}</span>
          ) : null}

          <span className="content-card__meta">
            <span className="content-card__kind">{kindLabel}</span>
            <time dateTime={item.published_on}>{formatDate(item.published_on)}</time>
            {item.size_bytes !== null ? <span>{formatSize(item.size_bytes)}</span> : null}
            {item.subject_name ? <span>{item.subject_name}</span> : null}
          </span>

          {item.teacher_display_name ? (
            <span className="content-card__teacher">
              <Icon name="user" size={14} />
              {item.teacher_display_name}
            </span>
          ) : null}
        </span>

        <span className="visually-hidden">{t('content.openItem')}</span>
      </button>
    </li>
  );
}

/** One icon per PRESENTATION class, not per extension — what a reader needs from
 *  the glyph is whether the thing plays, opens or downloads (§14.6). */
const ICONS: Record<ContentItem['kind'], IconName> = {
  pdf: 'document',
  video: 'video',
  audio: 'audio',
  image: 'image',
  document: 'file',
};

/**
 * Human file size. Binary units, one decimal place, and **`dir="ltr"` is not
 * needed** because the unit is an Arabic word rather than a Latin abbreviation —
 * mixing `MB` into RTL text is what forces a direction override.
 */
function formatSize(bytes: number): string {
  const units = tList('content.sizeUnits');
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit] ?? ''}`;
}

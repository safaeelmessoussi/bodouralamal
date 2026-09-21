import type { ReactNode } from 'react';

import type { LevelSummary } from '../../adapters/content.js';
import { t } from '../../i18n/index.js';
import { Icon } from '../ui/icon.js';

/**
 * One level on the library index.
 *
 * An `<a>`, not a button: this navigates, and a navigation dressed as a button
 * breaks middle-click, "open in new tab" and the screen-reader role. The same
 * rule the shared `Button`/`ButtonLink` split follows.
 *
 * The counts are the point of the card — a visitor choosing between levels wants
 * to know **how much is there** and **how far back it goes** before committing to
 * a page load. They are pluralised properly rather than rendered as
 * `2 محتوى`, because Arabic plural agreement is visible and getting it wrong
 * reads as machine output.
 */
export function LevelCard({ level }: { level: LevelSummary }): ReactNode {
  // R167 §5 — the shelf of what was made for EVERY Level of the Category. It is
  // the Category's, so it is addressed by the Category and named by the page.
  const categoryWide = level.kind === 'whole_category';
  const href = categoryWide
    ? `/resources?category=${encodeURIComponent(level.level_id)}`
    : `/resources?level=${encodeURIComponent(level.level_id)}`;
  return (
    <li>
      <a
        className={categoryWide ? 'level-card level-card--whole-category' : 'level-card'}
        href={href}
        {...(categoryWide ? { 'data-whole-category': level.level_id } : {})}
      >
        <span className="level-card__icon" aria-hidden="true">
          <Icon name={categoryWide ? 'book' : 'folder'} size={22} />
        </span>

        <span className="level-card__title">
          {categoryWide ? t('content.wholeCategory.title') : level.level_name}
        </span>

        {categoryWide ? (
          <span className="level-card__description">
            {t('content.wholeCategory.lede').replace('{category}', level.category_name)}
          </span>
        ) : null}

        {level.description ? (
          <span className="level-card__description">{level.description}</span>
        ) : null}

        {/* **Rendered only when a count actually exists.** `GET /library`
            publishes no aggregate (TD-3.13 is a flat filtered list), so these
            are `null` on the index — and a card showing "0 items" for a Level
            nobody has counted would be a claim, not a placeholder. The row
            disappears rather than lying. */}
        {level.content_count !== null || level.academic_year_count !== null ? (
          <span className="level-card__counts">
            {level.content_count !== null ? (
              <span className="level-card__count">
                <strong>{level.content_count}</strong>{' '}
                {countLabel(level.content_count, 'content.countItems')}
              </span>
            ) : null}
            {level.academic_year_count !== null ? (
              <span className="level-card__count">
                <strong>{level.academic_year_count}</strong>{' '}
                {countLabel(level.academic_year_count, 'content.countYears')}
              </span>
            ) : null}
          </span>
        ) : null}
      </a>
    </li>
  );
}

/**
 * Arabic plural agreement, reduced to the three forms this actually needs:
 * one, two, and many. Full CLDR pluralisation is overkill for two counters and
 * would need a rules table nothing else in the platform uses — but rendering
 * `1 مواد` is the kind of detail that makes an interface feel untranslated, so
 * the three cases are handled.
 */
function countLabel(count: number, base: string): string {
  if (count === 1) return t(`${base}.one`);
  if (count === 2) return t(`${base}.two`);
  return t(`${base}.many`);
}

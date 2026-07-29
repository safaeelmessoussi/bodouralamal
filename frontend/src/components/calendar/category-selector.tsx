import type { ReactNode } from 'react';

import type { CategoryRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';

/**
 * Category filter — the three educational stages (الكبار / اليافعون / الطفل).
 *
 * **The options come from the backend, never from a literal here.** Categories
 * are reference data a Super Admin owns, and §4.4b is explicit that clients
 * *"render the combinations the reference data exposes and must not hardcode
 * them"* — a hardcoded list would also silently encode the Revision-27 names
 * this project has already had to migrate away from once.
 *
 * Changing the category **resets the level**, which the page owns rather than
 * this control: the two selects are one filter with a dependency, and putting
 * the reset in the page keeps that relationship in one readable place.
 */
export function CategorySelector({
  categories,
  value,
  onChange,
}: {
  categories: CategoryRef[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
}): ReactNode {
  return (
    <div className="cal-filter">
      <label className="cal-filter__label" htmlFor="category-filter">
        {t('calendar.categoryLabel')}
      </label>
      <select
        id="category-filter"
        className="cal-filter__control"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('calendar.allCategories')}</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  );
}

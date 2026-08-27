import type { ReactNode } from 'react';

import type { CategoryRef } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { SelectField } from '../ui/field.js';

/**
 * Category filter — the platform's educational Categories (المرأة / اليافعات
 * / الطفل at launch; the set is data, so it may differ).
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
  // Built on the shared `SelectField` (Revision 39): the id is generated with
  // `useId` rather than hardcoded, so two instances on one page cannot collide
  // — the defect this file shipped with, alongside its two siblings.
  return (
    <SelectField
      label={t('calendar.categoryLabel')}
      value={value ?? ''}
      onChange={(next) => onChange(next === '' ? null : next)}
      placeholder={t('calendar.allCategories')}
      options={categories.map((category) => ({ value: category.id, label: category.name }))}
    />
  );
}

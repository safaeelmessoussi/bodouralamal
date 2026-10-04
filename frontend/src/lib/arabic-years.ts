import { t } from '../i18n/index.js';

/**
 * **Years counted in Arabic** (R197 — the Owner: «من 5 سنة» should be «من 5
 * سنوات», while «من 13 سنة» is right). The counted noun agrees with its
 * number: 3–10 take the plural (سنوات), 11 and above the singular (سنة), 2 the
 * dual and 1 «سنة واحدة» — both written in words, as Arabic writes them. The
 * forms are genitive, since every age phrase here follows «من», «إلى» or «حتى».
 */
export function yearsWords(n: number): string {
  if (n === 1) return t('common.years.one');
  if (n === 2) return t('common.years.two');
  const unit = n >= 3 && n <= 10 ? t('common.years.few') : t('common.years.many');
  return `${n} ${unit}`;
}

/**
 * «من 6 إلى 12 سنة» · «من 3 إلى 6 سنوات» · «من 18 سنة» · «حتى 10 سنوات» ·
 * `null` when no age is stated. A range names the unit once, after its upper
 * bound, which is the number it agrees with.
 */
export function ageRangeWords(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) {
    return t('admin.taxonomy.ageBetween').replace('{min}', String(min)).replace('{max}', yearsWords(max));
  }
  if (min !== null) return t('admin.taxonomy.ageFrom').replace('{min}', yearsWords(min));
  if (max !== null) return t('admin.taxonomy.ageUpTo').replace('{max}', yearsWords(max));
  return null;
}

import { ageRangeWords } from './arabic-years.js';

/**
 * **Which Categories a form offers, and how each is named** (SRS Revision 170 §6).
 *
 * One place, because three forms ask the same two questions — `/register`,
 * «طلب صفة إضافية» and «تسجيل ابن/ابنة» — and two answers to «may a child ask
 * for the adults' Category?» would be a defect the day they drifted.
 *
 * The SERVER decides (`CATEGORY_IS_GUARDIAN_MANAGED` / `CATEGORY_HOLDS_OWN_LOGIN`);
 * this only stops offering what would be refused. `null`/absent is «not stated»
 * and is offered to everyone, exactly as before the marker existed.
 */
interface AudienceCategory {
  id: string;
  name: string;
  holds_own_login?: boolean | null;
  min_age?: number | null;
  max_age?: number | null;
}

/** For a woman registering HERSELF: never a Category a guardian registers into. */
export function categoriesForSelf<C extends AudienceCategory>(categories: readonly C[]): C[] {
  return categories.filter((category) => category.holds_own_login !== false);
}

/** For a child application: never a Category whose beneficiaries hold the login. */
export function categoriesForChild<C extends AudienceCategory>(categories: readonly C[]): C[] {
  return categories.filter((category) => category.holds_own_login !== true);
}

/** «من 6 إلى 12 سنة» · «من 18 سنة» · «حتى 12 سنة» · `null` when not stated. */
export function ageRangeLabel(category: Pick<AudienceCategory, 'min_age' | 'max_age'>): string | null {
  // R197 — the counted noun agrees with its number (`lib/arabic-years.ts`).
  return ageRangeWords(category.min_age ?? null, category.max_age ?? null);
}

/** The Category as a form option: its name, and its age range where one is stated. */
export function categoryOptionLabel(category: AudienceCategory): string {
  const range = ageRangeLabel(category);
  return range === null ? category.name : `${category.name} (${range})`;
}

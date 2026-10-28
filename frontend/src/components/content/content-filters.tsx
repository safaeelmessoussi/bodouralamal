/**
 * Arabic search folding for the library (`resources.tsx`).
 *
 * **R255 — the one Level page's filter bar (`ContentFilters`, `applyFilters`)
 * went with that page**; the library's own filters live in `resources.tsx`.
 */
/** Fold the variant classes that actually collide in Moroccan Arabic input
 *  (TD-10's normalisation rules, minus the Latin and phone cases this page has
 *  no use for). */
export function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

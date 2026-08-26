import type { SortState } from '../components/ui/data-table.js';

/**
 * **Client-side sorting, for the lists the client genuinely owns** (R76.2).
 *
 * ## When this is correct, and when it is a lie
 *
 * `lib/sorting.ts` on the server exists because *"a client sorting the page it
 * holds would order **that page** and present it as the collection's order"*.
 * That reasoning is exact, and it is about **server-paginated** collections.
 * Two lists in this platform are not:
 *
 * | list | why the client owns it |
 * |---|---|
 * | `الجدولة` | a **merge of three sources** (classes, events, exams) assembled in `adapters/scheduling.ts` and already sorted here; there is no single endpoint to order |
 * | `إدخال الحفظ` roster | `/quran-students` answers the whole scope unpaginated, and the screen already filters it in memory |
 *
 * Anything paginated by the server sorts on the server. **This module must
 * never be used to reorder a page of a paginated collection** — that is the
 * defect the Owner named explicitly.
 *
 * ## Values, not labels
 *
 * Each column supplies a **typed accessor**, so ordering uses the semantic
 * value rather than the rendered Arabic string: a date sorts chronologically
 * rather than by how `formatDate` spelled it, and a number sorts numerically
 * rather than by the humanised size beside it.
 *
 * ## Arabic
 *
 * `Intl.Collator('ar')` — the browser's own locale ordering, which is the
 * client-side counterpart of the database's native `ar-x-icu` collation
 * (TD-6a). Comparing Arabic with `<` would order by UTF-16 code unit, which is
 * not alphabetical in any language.
 *
 * ## Absent values
 *
 * **Always last, in both directions.** An Event has no subject and a Global
 * item has no branch; absent is not *smallest*, so a reader looking from either
 * end sees the rows that have nothing to order by at the end rather than
 * ambushing the top of a descending sort.
 */
export type SortValue = string | number | Date | null | undefined;

/** How to read a column's semantic value. Keyed by the column's `sortKey`. */
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

function compare(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  // Absent last in BOTH directions, so the caller negates only the rest.
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return Number.POSITIVE_INFINITY;
  if (bEmpty) return Number.NEGATIVE_INFINITY;

  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() - new Date(b as string).getTime();
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Returns a new array in the requested order. **Stable**, so the list's own
 * default order survives among rows that tie — the same guarantee the server's
 * `id` tie-break gives a paginated collection.
 *
 * `sort === null` returns the rows untouched: no sort is a real state, not
 * ascending-by-something.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  accessors: SortAccessors<T>,
): T[] {
  if (sort === null) return [...rows];
  const read = accessors[sort.by];
  // A column the caller did not describe is left alone rather than ordered by
  // something unintended — the client-side counterpart of the server refusing
  // a field outside its allow-list.
  if (read === undefined) return [...rows];

  const factor = sort.dir === 'desc' ? -1 : 1;
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const result = compare(read(x.row), read(y.row));
      // The absent sentinels are ±Infinity so they survive the negation below
      // as "last" rather than flipping to first on a descending sort.
      if (!Number.isFinite(result)) return result > 0 ? 1 : -1;
      return result !== 0 ? result * factor : x.index - y.index;
    })
    .map((entry) => entry.row);
}

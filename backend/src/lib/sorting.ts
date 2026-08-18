import { AppError } from './errors.js';

/**
 * **List sorting — the single implementation** (SRS Proposal R76).
 *
 * ## The rule this exists to make unbreakable
 *
 * `sort_by` names a **field in the contract, never a database column.** Each
 * endpoint declares an allow-list mapping a public name to its own ordering
 * expression, and a name outside that list is refused rather than passed on. So
 * there is no path from a query string to a column name — not a sanitised one, an
 * *absent* one, which is the only version of this that stays true under
 * refactoring.
 *
 * ## Why the database sorts and the client does not
 *
 * TD-10 paginates every collection. A client sorting the page it holds would
 * order **that page** and present it as the collection's order — the second page
 * would then contain rows that belong on the first. Sorting is the database's for
 * the same reason pagination is.
 *
 * ## Determinism, and why it is not optional
 *
 * TD-10's pagination is offset-based, so two rows sharing a sort value have no
 * defined relative position — and an unstable order across `OFFSET` boundaries
 * makes a row appear on two pages or on neither. Every resolved order therefore
 * **ends in `id`**, which is unique. Callers do not have to remember: `resolve`
 * appends it.
 *
 * ## Absent parameters change nothing
 *
 * With no `sort_by`, the caller receives the collection's own default — BR-19's
 * `display_order` then the `ar-x-icu` collated name for reference data. This adds
 * a capability; it does not move a default.
 */

/** A Prisma `orderBy` fragment. Deliberately loose: each service knows its own. */
export type OrderBy = Record<string, unknown>;

/**
 * One sortable field, as the contract names it.
 *
 * `build` receives the direction so a field can order by something other than
 * itself — a Level sorted by "category" orders by the Category's own columns,
 * which is a relation traversal the client neither names nor knows about.
 */
export type SortableFields = Record<string, (dir: 'asc' | 'desc') => OrderBy[]>;

export interface SortParams {
  sortBy?: string | undefined;
  sortDir?: string | undefined;
}

/** Reads R76's `?sort_by=` / `?sort_dir=` from a query object. */
export function sortParamsFrom(query: Record<string, unknown>): SortParams {
  const read = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  return { sortBy: read(query['sort_by']), sortDir: read(query['sort_dir']) };
}

/**
 * Resolves a request's sort against an endpoint's allow-list.
 *
 * @param fields   what this endpoint may be sorted by, by contract name
 * @param params   what the caller asked for
 * @param fallback the collection's own default — BR-19's order, usually
 *
 * **An unknown field is refused, never ignored.** Silently falling back would
 * make a typo look like a working sort, and would hide a client sending a column
 * name it should not know.
 */
export function resolveSort(
  fields: SortableFields,
  params: SortParams,
  fallback: OrderBy[],
): OrderBy[] {
  const { sortBy, sortDir } = params;

  if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
    throw new AppError('VALIDATION_FAILED', 'sort_dir must be asc or desc', {
      issues: [{ path: 'sort_dir', message: "expected 'asc' or 'desc'" }],
    });
  }
  // A direction with nothing to apply it to is a malformed request, not a
  // default: the caller believes they are sorting and they are not.
  if (sortBy === undefined) {
    if (sortDir !== undefined) {
      throw new AppError('VALIDATION_FAILED', 'sort_dir requires sort_by', {
        issues: [{ path: 'sort_by', message: 'required when sort_dir is given' }],
      });
    }
    return withTiebreak(fallback);
  }

  const build = Object.prototype.hasOwnProperty.call(fields, sortBy)
    ? fields[sortBy]
    : undefined;
  if (build === undefined) {
    throw new AppError('VALIDATION_FAILED', `cannot sort by ${sortBy}`, {
      issues: [{ path: 'sort_by', message: `expected one of: ${Object.keys(fields).join(', ')}` }],
    });
  }

  return withTiebreak(build(sortDir === 'desc' ? 'desc' : 'asc'));
}

/** Appends the unique tiebreaker unless the caller already ended with it. */
function withTiebreak(order: OrderBy[]): OrderBy[] {
  const last = order[order.length - 1];
  if (last && Object.prototype.hasOwnProperty.call(last, 'id')) return order;
  return [...order, { id: 'asc' }];
}

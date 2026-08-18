import { api } from '../lib/api.js';
import type { SortState } from '../components/ui/data-table.js';

/**
 * **The two R76 client-side halves, written once** (R76.1, R76.4).
 *
 * Five resources take the same sort parameters and the same reorder body. Five
 * copies of `params.set('sort_by', …)` would be five places for the parameter
 * name to drift from the server's, and the drift would be invisible: an endpoint
 * refuses an unknown `sort_by`, but a *misspelled parameter name* is simply
 * ignored and the list comes back in its default order, looking like a sort that
 * did nothing.
 */

/** Adds `sort_by`/`sort_dir` when a sort is active, and nothing when it is not. */
export function applySort(params: URLSearchParams, sort: SortState | null): URLSearchParams {
  if (sort !== null) {
    params.set('sort_by', sort.by);
    params.set('sort_dir', sort.dir);
  }
  return params;
}

/** The same, for the unpaginated lists that build a bare query string. */
export function sortQuery(sort: SortState | null, extra: Record<string, string> = {}): string {
  const params = applySort(new URLSearchParams(extra), sort);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * `PATCH /admin/{resource}/order` — the collection, in the order given.
 *
 * The body is the **sequence**; the server assigns `display_order` from each
 * id's position, so a duplicate or gapped value is impossible rather than
 * something this client must avoid producing. `within` names the parent for the
 * two resources whose order is scoped to one (§2.2) — a Category's Levels, a
 * Level's groups.
 *
 * Returns the resulting order, so the caller re-renders from the server's answer
 * rather than from its own optimistic guess.
 */
export async function reorderResource(
  resource: string,
  ids: readonly string[],
  token: string | null,
  within?: string,
): Promise<string[]> {
  const body = await api<{ data: { ids: string[] } }>(`/admin/${resource}/order`, {
    method: 'PATCH',
    token,
    body: within === undefined ? { ids } : { within, ids },
  });
  return body.data.ids;
}

import { api } from '../lib/api.js';
import { reorderResource, sortQuery } from './reorder.js';
import type { SortState } from '../components/ui/data-table.js';

/**
 * Reference-data selectors (TD-3 extension, 2026-08-05).
 *
 * **The canonical source for every admin selector needing a Subject or an
 * Academic Year.** A screen that needs either reads this adapter rather than
 * growing its own list — that is the point of the endpoints existing, not a
 * side effect.
 *
 * Both are unpaginated by contract: a selector offering a subset would
 * misrepresent the choice available.
 */

export interface SubjectRef {
  id: string;
  name: string;
  display_order: number | null;
  /**
   * TD-15 — and the reason there is only one Subject list. The الفئات والمواد
   * editor sends it back on an edit; a selector ignores it. Publishing it here
   * is what let that screen reuse this endpoint instead of a parallel read.
   */
  version: number;
  /**
   * **The Levels that teach this Subject** (2026-08-17).
   *
   * `GET /admin/subjects` carries it so `المواد` can show the dependency that
   * makes deletion refusable: a Subject paired with any Level cannot be deleted,
   * and an administrator meeting that refusal previously had no way to see which
   * Levels to unpair on `مواد المستوى`.
   *
   * The Category travels **beside** the Level rather than joined into it, because
   * `levelLabel` owns the `{Category} — {Level}` format (§4.4b — Level names are
   * not unique across Categories) and a pre-joined string would be a second
   * implementation of it.
   *
   * Absent from `GET /admin/levels/{id}/subjects`, which answers *which subjects
   * does THIS Level teach* and has no use for the reverse join.
   */
  levels?: { id: string; name: string; category_name: string }[];
}

export interface AcademicYearRef {
  id: string;
  /** `YYYY-YYYY` (§4.10, TD-6). */
  label: string;
  /** Lets a form default to the live year rather than asking someone to recall it. */
  is_current: boolean;
}

export async function listSubjects(
  token: string | null,
  sort: SortState | null = null,
): Promise<SubjectRef[]> {
  const body = await api<{ data: SubjectRef[] }>(`/admin/subjects${sortQuery(sort)}`, { token });
  return body.data;
}

/** R76.4 — the subjects, in the order given. */
export async function reorderSubjects(
  ids: readonly string[],
  token: string | null,
): Promise<string[]> {
  return reorderResource('subjects', ids, token);
}

export async function listAcademicYears(token: string | null): Promise<AcademicYearRef[]> {
  const body = await api<{ data: AcademicYearRef[] }>('/admin/academic-years', { token });
  return body.data;
}

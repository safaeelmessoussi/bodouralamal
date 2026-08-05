import { api } from '../lib/api.js';

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
}

export interface AcademicYearRef {
  id: string;
  /** `YYYY-YYYY` (§4.10, TD-6). */
  label: string;
  /** Lets a form default to the live year rather than asking someone to recall it. */
  is_current: boolean;
}

export async function listSubjects(token: string | null): Promise<SubjectRef[]> {
  const body = await api<{ data: SubjectRef[] }>('/admin/subjects', { token });
  return body.data;
}

export async function listAcademicYears(token: string | null): Promise<AcademicYearRef[]> {
  const body = await api<{ data: AcademicYearRef[] }>('/admin/academic-years', { token });
  return body.data;
}

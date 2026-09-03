import { api } from '../lib/api.js';
import { applySort } from './reorder.js';
import type { SortState } from '../components/ui/data-table.js';

/**
 * Enrolment — **مستفيدة → Level**, with an optional Group (§7 R66, §14.1 R74).
 *
 * **Not a second roster.** `/admin/administrative-groups/{id}/roster` is the
 * per-group view of these very same rows; this is the per-Level one, which R66
 * made the primary fact. Both place a student through `enrolAtPlacement`.
 */
export interface EnrollmentRowView {
  id: string;
  student_id: string;
  student_name: string;
  level_id: string;
  level_name: string;
  category_name: string;
  branch_id: string;
  branch_name: string;
  administrative_group_id: string | null;
  administrative_group_name: string | null;
  /** Read-only context. Circle membership is managed on حلقات المواد and is
   *  independent of the group (§4.4c); it appears here only so
   *  مستفيدة → مستوى → مجموعة → مادة → حلقة is legible in one place. */
  circles: { subject_name: string; circle_name: string }[];
  /**
   * **R122 — which semester this enrolment is for, and whether it is running.**
   *
   * `is_current_period` is derived by the server from the period's dates, not
   * stored: an enrolment stops being current when its semester ends, without
   * anybody closing a row. `null` on rows written before the revision, whose
   * period was never recorded and was deliberately not guessed.
   */
  academic_period_id: string | null;
  academic_period_sequence: number | null;
  academic_year_label: string | null;
  is_current_period: boolean;
}

export async function listEnrollments(
  token: string | null,
  filters: { level_id?: string } = {},
  sort: SortState | null = null,
): Promise<EnrollmentRowView[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  applySort(params, sort);
  const query = params.toString();
  return (
    await api<{ data: EnrollmentRowView[] }>(`/admin/enrollments${query ? `?${query}` : ''}`, {
      token,
    })
  ).data;
}

/** `administrative_group_id: null` enrols into the LEVEL itself — a real
 *  placement since R66, and the one that had no route at all. */
export async function enrol(
  input: {
    student_id: string;
    level_id: string;
    branch_id: string;
    administrative_group_id?: string | null;
    /** R122 — required: an enrolment names the semester it is for. */
    academic_period_id: string;
  },
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>('/admin/enrollments', { method: 'POST', token, body: input });
}

/**
 * `PATCH /admin/enrollments/{id}` — the placement **within its Level**.
 *
 * **No `level_id`.** BR-21 makes `(student, level)` unique, so an enrolment *is*
 * that pair: moving to another Level is ending one and beginning another, which
 * `remove` and `enrol` already express. The server refuses the key rather than
 * dropping it.
 */
export async function updateEnrollment(
  id: string,
  patch: { administrative_group_id?: string | null; branch_id?: string },
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/enrollments/${id}`, { method: 'PATCH', token, body: patch });
}

/** Ends it, group or not — the case the group-keyed roster could not reach. */
export async function endEnrollment(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/enrollments/${id}`, { method: 'DELETE', token });
}

import { api } from '../lib/api.js';

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
}

export async function listEnrollments(
  token: string | null,
  filters: { level_id?: string } = {},
): Promise<EnrollmentRowView[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
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
  },
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>('/admin/enrollments', { method: 'POST', token, body: input });
}

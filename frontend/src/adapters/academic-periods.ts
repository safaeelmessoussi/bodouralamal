import { api } from '../lib/api.js';

/**
 * **Academic periods — the semesters a year is made of** (SRS R122).
 *
 * The enrolment form's source. An `Enrollment` names one, which is what makes
 * *is this beneficiary enrolled right now* answerable without anybody having
 * remembered to close a row.
 */
export interface AcademicPeriodRef {
  id: string;
  academic_year_id: string;
  academic_year_label: string;
  /** 1 is the first semester. The Arabic label is composed from this. */
  sequence: number;
  /** TD-11 calendar dates. `end_date` is inclusive. */
  start_date: string;
  end_date: string;
  /** Derived by the server from the dates — never stored, never inferred here. */
  is_current: boolean;
  version: number;
}

export async function listAcademicPeriods(
  token: string | null,
  filters: { academic_year_id?: string } = {},
): Promise<AcademicPeriodRef[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const query = params.toString();
  return (
    await api<{ data: AcademicPeriodRef[] }>(
      `/admin/academic-periods${query ? `?${query}` : ''}`,
      { token },
    )
  ).data;
}

export interface AcademicPeriodInput {
  academic_year_id: string;
  sequence: number;
  start_date: string;
  end_date: string;
}

export async function createAcademicPeriod(
  input: AcademicPeriodInput,
  token: string | null,
): Promise<AcademicPeriodRef> {
  return api<AcademicPeriodRef>('/admin/academic-periods', {
    method: 'POST',
    body: input,
    token,
  });
}

/**
 * **`academic_year_id` is deliberately absent from the patch** (rule AF).
 *
 * Moving a period into another year would silently rewrite which year every
 * enrolment naming it belongs to. The route refuses the key outright; the form
 * shows the year as text and says which action does change it.
 */
export async function updateAcademicPeriod(
  id: string,
  version: number,
  patch: { sequence: number; start_date: string; end_date: string },
  token: string | null,
): Promise<AcademicPeriodRef> {
  return api<AcademicPeriodRef>(`/admin/academic-periods/${id}`, {
    method: 'PATCH',
    body: { ...patch, version },
    token,
  });
}

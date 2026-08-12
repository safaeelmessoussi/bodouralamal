import { api } from '../lib/api.js';

/**
 * Grade entry (§4.6, BR-7, BR-8, BR-12; SRS Revision 70).
 *
 * **Marks cross the wire on the association's /20 scale; storage is basis
 * points.** The conversion belongs to the server — Revision 8 requires the
 * round-half-up exactly once, at final persistence, and a client that converted
 * would be a second rounding site deciding whether somebody passed. The sheet
 * carries `display_scale` so the interface can render bp back to a mark without
 * knowing the rule.
 */

export interface GradeSheetRow {
  student_id: string;
  student_name: string;
  /** `null` is **unmarked** — never `0`, which is a mark somebody entered. */
  value_bp: number | null;
  absent: boolean;
  status: 'draft' | 'published';
  manual_pass_fail_override: boolean | null;
  override_reason: string | null;
  version: number | null;
  passed: boolean | null;
}

export interface GradeSheet {
  exam: {
    id: string;
    title: string;
    date: string;
    level_id: string;
    level_name: string;
    subject_id: string | null;
    subject_name: string | null;
    branch_id: string | null;
    branch_name: string | null;
    administrative_group_id: string | null;
    administrative_group_name: string | null;
    /** Derived by the server from `created_at > date` — no column exists. */
    recorded_late: boolean;
  };
  display_scale: number;
  passing_grade_bp: number;
  has_published: boolean;
  rows: GradeSheetRow[];
}

export interface GradeEntryInput {
  student_id: string;
  /** `null` leaves the student unmarked; BR-7 makes them absent-zero on save. */
  mark: number | null;
  absent: boolean;
  version?: number;
}

export async function fetchGradeSheet(examId: string, token: string | null): Promise<GradeSheet> {
  const body = await api<{ data: GradeSheet }>(`/exams/${examId}/grades`, { token });
  return body.data;
}

export async function saveGrades(
  examId: string,
  entries: GradeEntryInput[],
  token: string | null,
): Promise<{ saved: number; initialised: number }> {
  const body = await api<{ data: { saved: number; initialised: number } }>(
    `/exams/${examId}/grades`,
    { method: 'PUT', token, body: { entries } },
  );
  return body.data;
}

/** BR-8. Re-publishing is the same call; the server reports which it was. */
export async function publishGrades(
  examId: string,
  token: string | null,
): Promise<{ published: number; republished: boolean }> {
  const body = await api<{ data: { published: number; republished: boolean } }>(
    `/exams/${examId}/grades/publish`,
    { method: 'POST', token },
  );
  return body.data;
}

/** BR-12 — `value: null` clears the override and restores the computed result. */
export async function overridePassFail(
  examId: string,
  studentId: string,
  input: { value: boolean | null; reason?: string; version: number },
  token: string | null,
): Promise<void> {
  await api<void>(`/exams/${examId}/grades/${studentId}/override`, {
    method: 'POST',
    token,
    body: input,
  });
}

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

/**
 * `GET /students/me/grades` — **a مستفيدة's own published grades** (§5.3).
 *
 * ## Why there is no id in the call
 *
 * The acting student is resolved server-side from the JWT or, for a parent, from
 * `X-Active-Child-ID` (§4.3) — passed through the one API caller that may set
 * that header, exactly as `fetchStudentIdentity` does. The client never names a
 * student, which is what makes *"could a parent read another child's marks"* a
 * question with no code path rather than a check to review.
 *
 * ## What the row deliberately does not carry
 *
 * **No pass/fail.** The staff sheet keeps it — BR-8's publication states and
 * BR-12's override are untouched in the model — but this screen reports what she
 * scored, not a verdict about her (Owner decision, 2026-08-17).
 *
 * **No draft.** Not hidden here: absent from the server's query.
 */
export interface PublishedGrade {
  exam_id: string;
  exam_title: string;
  date: string;
  level_name: string;
  subject_name: string | null;
  /** Already on the display scale — the server converted from basis points. */
  mark: number;
  absent: boolean;
}

export async function fetchMyGrades(
  token: string | null,
  activeChildId: string | null,
): Promise<{ rows: PublishedGrade[]; displayScale: number }> {
  const body = await api<{ data: PublishedGrade[]; meta: { display_scale: number } }>(
    '/students/me/grades',
    { token, activeChildId },
  );
  return { rows: body.data, displayScale: body.meta.display_scale };
}

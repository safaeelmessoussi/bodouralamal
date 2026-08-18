import { api } from '../lib/api.js';

/**
 * Grade entry (§4.6, BR-7, BR-8; SRS Revision 81).
 *
 * **A score is itself, out of its own exam's maximum.** No conversion crosses
 * this boundary in either direction: the number typed is the number sent, stored
 * and read back. The sheet carries the exam's `max_grade` because that is what
 * «النقطة (من 20)» is built from, and there is no platform-wide scale to ask.
 */

export interface GradeSheetRow {
  student_id: string;
  student_name: string;
  /** `null` is **unmarked** — never `0`, which is a score somebody entered. */
  score: number | null;
  absent: boolean;
  status: 'draft' | 'published';
  version: number | null;
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
  /** What every score on this sheet is out of (R81). */
  max_grade: number;
  has_published: boolean;
  rows: GradeSheetRow[];
}

export interface GradeEntryInput {
  student_id: string;
  /** `null` leaves the student unmarked; BR-7 makes them absent-zero on save. */
  score: number | null;
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
 * **No pass/fail — anywhere.** R81 retired the passing threshold, the computed
 * verdict and BR-12's manual override together: a grade is a grade, and nothing
 * in the platform labels a person from one.
 *
 * **No draft.** Not hidden here: absent from the server's query.
 */
export interface PublishedGrade {
  exam_id: string;
  exam_title: string;
  date: string;
  level_name: string;
  subject_name: string | null;
  /** The score she was given. */
  score: number;
  /** What it was out of — **per row**, because each exam sets its own (R81). */
  max_grade: number;
  absent: boolean;
}

export async function fetchMyGrades(
  token: string | null,
  activeChildId: string | null,
): Promise<PublishedGrade[]> {
  const body = await api<{ data: PublishedGrade[] }>('/students/me/grades', {
    token,
    activeChildId,
  });
  return body.data;
}

import { api } from '../lib/api.js';

/**
 * **The assessment builder** (SRS §4.6, R124) — the online half of `Exam`.
 *
 * Rooted at `/assessments` rather than `/exams`: the two ask different things
 * of a caller. `/exams` schedules a **sitting** — a room, a clock window,
 * supervisors — and this writes a **paper**. Grading is neither: it is
 * `/exams/{id}/grades`, unchanged, because the whole reason no second entity
 * exists is that `Grade` already carries the scale and the publication rule.
 */
export type QuestionKind = 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice';
export type JustificationRule = 'none' | 'optional' | 'required';
export type AssessmentStatus = 'draft' | 'published' | 'closed';
export type TargetKind =
  | 'level'
  | 'administrative_group'
  | 'session'
  | 'teaching_group'
  | 'student';

export interface AssessmentQuestion {
  id: string;
  display_order: number;
  kind: QuestionKind;
  prompt: string;
  justification: JustificationRule;
  options: { id: string; display_order: number; label: string }[];
}

export interface AssessmentAnswer {
  question_id: string;
  text: string | null;
  justification: string | null;
  option_ids: string[];
}

export interface AssessmentPaper {
  id: string;
  title: string;
  description: string | null;
  status: AssessmentStatus;
  target_kind: TargetKind;
  date: string;
  max_grade: string;
  questions: AssessmentQuestion[];
  /** `null` when this person has not started. **Never another student's.** */
  submission: {
    state: string;
    submitted_at: string | null;
    answers: AssessmentAnswer[];
  } | null;
}

export interface StudentAssessment {
  id: string;
  title: string;
  status: AssessmentStatus;
  date: string;
  /** `null` = not started · `in_progress` = saved · `submitted`. */
  state: string | null;
  grade_published: boolean;
}

export interface SubmissionRow {
  student_id: string;
  name: string | null;
  state: string;
  submitted_at: string | null;
  grade_status: string | null;
  score: string | null;
}

export async function createAssessment(
  input: {
    title: string;
    description?: string | null;
    max_grade: number;
    level_id: string;
    subject_id?: string | null;
    academic_year_id?: string | null;
    target: { kind: TargetKind; id?: string };
    date?: string;
  },
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>('/assessments', { method: 'POST', body: input, token });
}

export async function addQuestion(
  examId: string,
  input: {
    kind: QuestionKind;
    prompt: string;
    justification?: JustificationRule;
    options?: string[];
  },
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>(`/assessments/${examId}/questions`, {
    method: 'POST',
    body: input,
    token,
  });
}

export async function updateQuestion(
  examId: string,
  questionId: string,
  version: number,
  patch: { prompt?: string; justification?: JustificationRule; options?: string[] },
  token: string | null,
): Promise<void> {
  await api<void>(`/assessments/${examId}/questions/${questionId}`, {
    method: 'PATCH',
    body: { ...patch, version },
    token,
  });
}

export async function removeQuestion(
  examId: string,
  questionId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/assessments/${examId}/questions/${questionId}`, { method: 'DELETE', token });
}

/** **The whole sequence** (R76) — up/down move one place and send all of it. */
export async function reorderQuestions(
  examId: string,
  ids: string[],
  token: string | null,
): Promise<void> {
  await api<void>(`/assessments/${examId}/questions/order`, {
    method: 'PATCH',
    body: { ids },
    token,
  });
}

export async function publishAssessment(examId: string, token: string | null): Promise<void> {
  await api<void>(`/assessments/${examId}/publish`, { method: 'POST', body: {}, token });
}

export async function closeAssessment(examId: string, token: string | null): Promise<void> {
  await api<void>(`/assessments/${examId}/close`, { method: 'POST', body: {}, token });
}

export async function listSubmissions(
  examId: string,
  token: string | null,
): Promise<{ eligible_count: number; data: SubmissionRow[] }> {
  return api<{ eligible_count: number; data: SubmissionRow[] }>(
    `/assessments/${examId}/submissions`,
    { token },
  );
}

export async function readSubmission(
  examId: string,
  studentId: string,
  token: string | null,
): Promise<AssessmentPaper> {
  return api<AssessmentPaper>(`/assessments/${examId}/submissions/${studentId}`, { token });
}

/* ── The beneficiary's own three ──────────────────────────────────────────── */

export async function myAssessments(token: string | null): Promise<StudentAssessment[]> {
  return (await api<{ data: StudentAssessment[] }>('/me/assessments', { token })).data;
}

export async function readPaper(examId: string, token: string | null): Promise<AssessmentPaper> {
  return api<AssessmentPaper>(`/assessments/${examId}/paper`, { token });
}

type AnswerPayload = {
  question_id: string;
  text?: string | null;
  justification?: string | null;
  option_ids?: string[];
};

/**
 * **حفظ.** A draft: incomplete is fine and nothing is final.
 *
 * **SAVE is not SUBMIT**, and the two are separate functions here for the same
 * reason they are separate routes — one of them cannot be undone.
 */
export async function saveResponses(
  examId: string,
  answers: AnswerPayload[],
  token: string | null,
): Promise<{ state: string }> {
  return api<{ state: string }>(`/assessments/${examId}/responses`, {
    method: 'PUT',
    body: { answers },
    token,
  });
}

/** **إرسال** — final for the student. The interface confirms first. */
export async function submitResponses(
  examId: string,
  answers: AnswerPayload[],
  token: string | null,
): Promise<{ state: string }> {
  return api<{ state: string }>(`/assessments/${examId}/submit`, {
    method: 'POST',
    body: { answers },
    token,
  });
}

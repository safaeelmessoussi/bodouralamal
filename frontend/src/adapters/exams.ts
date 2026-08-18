import { api } from '../lib/api.js';

/**
 * Physical exam sittings (§4.6 as amended by SRS Revision 58).
 *
 * **A sitting, not a paper.** R58 supersedes §4.6's *"digital exams only in
 * MVP"*: the platform now organises where and when an exam is sat — branch,
 * room, date, clock window and staff — while the paper itself (its questions,
 * its print layout, the marking of scripts) stays outside.
 *
 * **`online` is declared and refused.** The mode is offered in the interface,
 * disabled, with its reason stated (§14.4); the server answers
 * `ONLINE_NOT_AVAILABLE` if anything sends it anyway. There is deliberately **no
 * online endpoint, no online field and no online screen** — a field with nothing
 * behind it is a promise the platform has not made.
 */

export type ExamMode = 'physical' | 'online';
export type ExamStaffPosition = 'supervisor' | 'assistant';

export interface ExamStaffRef {
  user_id: string;
  position: ExamStaffPosition;
}

export interface Exam {
  id: string;
  mode: ExamMode;
  title: string;
  description: string | null;
  /** TD-11 calendar date and wall-clock times — never instants. */
  date: string;
  start_time: string | null;
  end_time: string | null;
  level_id: string;
  /** **Names beside every id**: a timetable cannot be read from ids, and this
   *  list sits beside classes and activities on one screen. */
  level_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
  academic_year_id: string | null;
  branch_id: string | null;
  branch_name: string | null;
  room_id: string | null;
  room_name: string | null;
  /** `null` is **the whole Level** (R58), never "no target". */
  administrative_group_id: string | null;
  administrative_group_name: string | null;
  /** R81 — what marks on this exam are out of. Per exam; no global scale. */
  max_grade: number;
  staff: ExamStaffRef[];
  version: number;
}

export interface ExamInput {
  /** Sent explicitly so the refusal of `online` is a *coded* answer from the
   *  server rather than something the client silently prevents. */
  mode: ExamMode;
  title: string;
  description?: string | null;
  date: string;
  start_time: string;
  end_time: string;
  level_id: string;
  subject_id: string;
  academic_year_id: string;
  branch_id: string;
  room_id: string;
  administrative_group_id?: string | null;
  /** R81 — required on create: an exam with no maximum cannot be marked. */
  max_grade: number;
  staff?: ExamStaffRef[];
}

export interface ExamFilters {
  branch_id?: string;
  level_id?: string;
  from?: string;
  to?: string;
}

export async function listExams(
  token: string | null,
  filters: ExamFilters = {},
  pageSize = 100,
): Promise<{ data: Exam[]; meta: { total: number } }> {
  const params = new URLSearchParams({ page_size: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return api<{ data: Exam[]; meta: { total: number } }>(`/exams?${params.toString()}`, { token });
}

export async function createExam(input: ExamInput, token: string | null): Promise<{ id: string }> {
  return api<{ id: string }>('/exams', { method: 'POST', token, body: input });
}

/**
 * **Arrangements only.** `mode`, `level_id`, `subject_id`, `academic_year_id`
 * and `branch_id` are refused by the server rather than dropped: each would
 * change *what is examined, for whom, or where* while keeping the grades already
 * recorded against the old answer. Moving an exam to another level is a new exam.
 */
export async function updateExam(
  id: string,
  version: number,
  input: Partial<
    Pick<
      ExamInput,
      | 'title'
      | 'description'
      | 'date'
      | 'start_time'
      | 'end_time'
      | 'room_id'
      | 'administrative_group_id'
      | 'staff'
    >
  >,
  token: string | null,
): Promise<void> {
  await api<void>(`/exams/${id}`, { method: 'PATCH', token, body: { version, ...input } });
}

/** TD-5 soft delete plus a Trash snapshot; the staff rows go with it. */
export async function deleteExam(id: string, token: string | null): Promise<void> {
  await api<void>(`/exams/${id}`, { method: 'DELETE', token });
}

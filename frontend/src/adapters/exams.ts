import { applySort } from './reorder.js';
import type { SortState } from '../components/ui/data-table.js';
import { api } from '../lib/api.js';

/**
 * Physical exam sittings (§4.6 as amended by SRS Revision 58), plus R136's
 * unified scheduling write for both delivery modes.
 *
 * **A sitting, not a paper.** R58 supersedes §4.6's *"digital exams only in
 * MVP"*: the platform now organises where and when an exam is sat — branch,
 * room, date, clock window and staff — while the paper itself (its questions,
 * its print layout, the marking of scripts) stays outside.
 *
 * **`createExam`/`POST /exams` stays a lower-level, content-free primitive**
 * — `online` is still refused there (`ONLINE_NOT_AVAILABLE`) — but it is no
 * longer الجدولة's own write path. `scheduleExam` below (`POST
 * /exams/schedule`, R136) is: one atomic call, for either mode, that copies
 * a بناء الاختبارات draft into an independent scheduled occurrence (or, for
 * a physical sitting with no authored paper, creates one bare, exactly as
 * `createExam` always did).
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
  /**
   * **R109 — the sitting's own tier**, superseding §4.6's *"an exam has no
   * visibility tier of its own"* (that clause described the AUDIENCE). The edit
   * form hydrates from this rather than from a default.
   */
  visibility: string;
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
  /** R110 — the catalogue row, `null` on a pre-catalogue row. */
  scheduling_type_id: string | null;
  academic_year_id: string | null;
  branch_id: string | null;
  branch_name: string | null;
  room_id: string | null;
  room_name: string | null;
  /** `null` is **the whole Level** (R58), never "no target". */
  administrative_group_id: string | null;
  administrative_group_name: string | null;
  /** R136 — the target arm; an online occurrence may name any of R125's
   *  five, not only `level`/`administrative_group`. */
  target_kind: 'level' | 'administrative_group' | 'session' | 'teaching_group' | 'student';
  teaching_group_name: string | null;
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
  /** R109 — the sitting's own tier. Declared rather than spread, for the reason
   *  `CourseScheduleInput.visibility` records. */
  visibility?: string;
  date: string;
  /**
   * **R110 (Owner, 2026-09-02) — which catalogue row this is.**
   *
   * Declared rather than merely spread, for the reason `visibility` records:
   * a key absent from this interface travels unchecked.
   *
   * Omitted leaves it alone; `null` clears it. A row created before the
   * catalogue carries none, and none was guessed for it.
   */
  scheduling_type_id?: string | null;
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

/**
 * **R136 (H1) — one audience label, all five R125 arms.**
 *
 * The grading list used to read only `administrative_group_name`, falling
 * back to "the whole Level" — correct for the two arms a physical sitting
 * could ever carry, and silently wrong for an online occurrence's other
 * three: a `session`/`teaching_group`/`student` target read as *the whole
 * Level* is a real comprehension risk on a screen a مؤطِّرة is grading from.
 * `session` and `student` stay deliberately generic rather than naming the
 * occurrence or the beneficiary — the same privacy-conscious choice the
 * calendar's own `audience_label` makes, for the same reason (a grading list
 * is read by everybody the caller's own scope admits, which is wider than
 * *this specific student's* audience).
 */
export function examAudienceLabel(
  exam: Pick<Exam, 'target_kind' | 'administrative_group_name' | 'teaching_group_name'>,
  labels: { session: string; student: string; wholeLevel: string },
): string {
  switch (exam.target_kind) {
    case 'teaching_group':
      return exam.teaching_group_name ?? labels.wholeLevel;
    case 'session':
      return labels.session;
    case 'student':
      return labels.student;
    case 'administrative_group':
      return exam.administrative_group_name ?? labels.wholeLevel;
    case 'level':
    default:
      return labels.wholeLevel;
  }
}

export async function listExams(
  token: string | null,
  filters: ExamFilters = {},
  pageSize = 100,
  /** R76 — the server orders; `resolveSort` refuses a field outside the
   *  endpoint's allow-list rather than ignoring it. */
  sort: SortState | null = null,
): Promise<{ data: Exam[]; meta: { total: number } }> {
  const params = new URLSearchParams({ page_size: String(pageSize) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  applySort(params, sort);
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

/**
 * **R136 clause 9/10 — six labelled choices, one stored fact.** `manual`
 * leaves `Exam.available_from` `NULL` — an operator opens it later, one-way,
 * never automatically. `at_start`/`offset_minutes` need the occurrence's own
 * `start_time` to anchor on. `custom` is an explicit instant. Absent means
 * `manual` — the safe default nobody chose is *not yet reachable*, not
 * *reachable now*.
 */
export type ExamAvailabilityPolicy =
  | { policy: 'manual' }
  | { policy: 'at_start' }
  | { policy: 'offset_minutes'; minutes: number }
  | { policy: 'custom'; at: string };

export interface ScheduleExamTarget {
  kind: 'level' | 'administrative_group' | 'session' | 'teaching_group' | 'student';
  id?: string;
}

export interface ScheduleExamInput {
  mode: ExamMode;
  /** Required for `online` (a remote occurrence always copies authored
   *  content); optional for `physical`, which may still be content-free. */
  source_exam_id?: string;
  target: ScheduleExamTarget;
  /** Refused on a `session` target — R122, the occurrence's own date. */
  date?: string;
  /** Physical only. */
  start_time?: string;
  end_time?: string;
  branch_id?: string;
  room_id?: string;
  scheduling_type_id?: string | null;
  visibility?: string;
  staff?: ExamStaffRef[];
  /** Remote only. Absent means `manual`. */
  availability?: ExamAvailabilityPolicy;
  /** Required exactly when `source_exam_id` is absent on a `physical`
   *  sitting — its own title/maximum/Level/Subject/year, since there is no
   *  source to take them from. */
  bare?: {
    title: string;
    max_grade: number;
    description?: string | null;
    level_id: string;
    subject_id: string;
    academic_year_id: string;
  };
}

/**
 * **الجدولة's ONE write, for both delivery modes** (R136). One atomic
 * transaction: authorize the source, copy it, assign the occurrence's
 * target/date/place, set availability, freeze and publish, notify. Answers
 * the new OCCURRENCE's id — never the source's own, which stays `draft` and
 * unchanged (R136 clause 3).
 */
export async function scheduleExam(
  input: ScheduleExamInput,
  token: string | null,
): Promise<{ id: string }> {
  return api<{ id: string }>('/exams/schedule', { method: 'POST', body: input, token });
}

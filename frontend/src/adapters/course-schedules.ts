import { api } from '../lib/api.js';

/**
 * Recurring Course Schedules (§4.4, §5.6, TD-3.12, Revision 43) — the unit of
 * **delivery**.
 *
 * The types are exactly the endpoint's contract DTO (§16.2), so a field the API
 * stops sending becomes a type error here rather than an empty cell on the page.
 *
 * **Adapters adapt contracts; they do not repair them.** Nothing here reshapes
 * a response — the `{ schedule, materialization }` envelope, the wall-clock
 * `HH:MM` strings and the single `teaching_mode` + `target_id` pair are the wire
 * contract, and a repair at this seam would leave the contract wrong for the
 * next client while hiding that it is wrong from everyone.
 */

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export interface ScheduleStaff {
  user_id: string;
  position: string;
}

export interface CourseSchedule {
  id: string;
  subject_id: string;
  /** One mode, one target (§4.4c) — never three nullable target columns. */
  teaching_mode: string;
  target_id: string;
  branch_id: string;
  room_id: string | null;
  /** TD-11 **wall-clock** `HH:MM`, never an instant — a class starts at 15:00
   *  at its branch, and an instant would invite a timezone shift here. */
  start_time: string;
  end_time: string;
  recurrence: string;
  weekdays: string[];
  day_of_month: number | null;
  month_of_year: number | null;
  /** TD-11 calendar date, `YYYY-MM-DD`. */
  anchor_date: string | null;
  academic_year_id: string;
  staff: ScheduleStaff[];
  /** TD-15: loaded with the row, sent back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * A Session a write deliberately left alone (§4.4, R43.6).
 *
 * Surfaced because a write that reported only what it changed would claim the
 * timetable is consistent when part of it knowingly is not.
 */
export interface ProtectedSession {
  id: string;
  /** TD-11 calendar date. */
  date: string;
  /** Every applicable reason — an administrator deciding whether to override
   *  one deserves all of them, not the first that matched. */
  reasons: string[];
}

export interface Materialization {
  created: number;
  existing: number;
  /** Future, un-overridden Sessions brought back into line with the schedule. */
  resynced: number;
  protected_sessions: ProtectedSession[];
}

/** A booking clash, found against **materialized Sessions**, never against rules. */
export interface ScheduleConflict {
  kind: string;
  date: string;
  session_id: string;
  schedule_id: string;
  /** The person or room both classes want. */
  resource_id: string;
}

/** A student in the schedule's **resolved** audience — recomputed per request. */
export interface ScheduleRosterEntry {
  student_id: string;
  name: string | null;
}

export interface ScheduleFilters {
  branch_id?: string;
  subject_id?: string;
  academic_year_id?: string;
}

export async function listCourseSchedules(
  token: string | null,
  page = 1,
  filters: ScheduleFilters = {},
): Promise<Page<CourseSchedule>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return api<Page<CourseSchedule>>(`/admin/course-schedules?${params.toString()}`, { token });
}

export async function readConflicts(
  id: string,
  token: string | null,
): Promise<{ conflicts: ScheduleConflict[] }> {
  return api<{ conflicts: ScheduleConflict[] }>(`/admin/course-schedules/${id}/conflicts`, {
    token,
  });
}

export async function readScheduleRoster(
  id: string,
  token: string | null,
): Promise<{ students: ScheduleRosterEntry[] }> {
  return api<{ students: ScheduleRosterEntry[] }>(`/admin/course-schedules/${id}/roster`, {
    token,
  });
}

/**
 * TD-5. **Answers `200 { future_removed, retained }`, not `204`** — `retained`
 * counts Sessions holding data whose loss would change historical truth, which
 * survive the schedule that created them. The screen shows the number because
 * it is unavailable afterwards.
 */
export async function deleteCourseSchedule(
  id: string,
  token: string | null,
): Promise<{ future_removed: number; retained: number }> {
  return api<{ future_removed: number; retained: number }>(`/admin/course-schedules/${id}`, {
    method: 'DELETE',
    token,
  });
}

export interface CourseScheduleInput {
  subject_id: string;
  teaching_mode: string;
  /** Exactly one target, of the kind the mode names (§4.4c). */
  target_id: string;
  branch_id: string;
  room_id?: string | null;
  /** TD-11 wall-clock `HH:MM` — an ISO instant is refused by the server. */
  start_time: string;
  end_time: string;
  recurrence: string;
  weekdays?: string[];
  academic_year_id: string;
  staff?: { user_id: string; position: string }[];
}

export interface ScheduleWriteResult {
  schedule: CourseSchedule;
  materialization: Materialization;
}

export async function createCourseSchedule(
  input: CourseScheduleInput,
  token: string | null,
): Promise<ScheduleWriteResult> {
  return api<ScheduleWriteResult>('/admin/course-schedules', {
    method: 'POST',
    token,
    body: input,
  });
}

/**
 * **Only the *when* and the *where in the building* are editable.** Subject,
 * mode, target, branch and academic year are rejected by the server rather than
 * ignored — each would re-point Sessions already materialized against the old
 * answer — so this signature is the contract, not a convenience.
 */
export async function updateCourseSchedule(
  id: string,
  version: number,
  input: Partial<
    Pick<CourseScheduleInput, 'room_id' | 'start_time' | 'end_time' | 'recurrence' | 'weekdays'>
  >,
  token: string | null,
): Promise<ScheduleWriteResult> {
  return api<ScheduleWriteResult>(`/admin/course-schedules/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
}

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
  /** R91 — the assignment's inclusive effective period. `null` at either end is
   *  open-ended there: from the schedule's beginning, through its end. */
  effective_from?: string | null;
  effective_until?: string | null;
}

export interface CourseSchedule {
  id: string;
  /** R123 — who may record presence at this class's occurrences. Optional on
   *  the type because reads that predate the field carry none; the mapper
   *  falls back to `staff_only`, never to the permissive setting. */
  attendance_marking?: 'staff_only' | 'self_or_staff';
  /** R57 — what the class is CALLED. A label, never an identifier. */
  title: string;
  description: string | null;
  /**
   * **R109 — the schedule's DEFAULT tier for the Sessions it materializes.**
   * `public | private | hidden`. The edit form hydrates from this; a client that
   * fell back to a default would re-publish a hidden class on an unrelated edit.
   */
  visibility: string;
  subject_id: string;
  /**
   * **Labels, never identifiers** — resolved server-side so a timetable can be
   * read. `null` on a write response, whose caller already knows them.
   */
  subject_name: string | null;
  /** R110 — the catalogue row, `null` on a pre-catalogue row. */
  scheduling_type_id: string | null;
  target_name: string | null;
  branch_name: string | null;
  room_name: string | null;
  /** One mode, one target (§4.4c) — never three nullable target columns. */
  teaching_mode: string;
  target_id: string;
  /**
   * **Which Level the class is for**, resolved server-side whatever the mode
   * names — for `entire_level` it equals `target_id`, and for the other two it
   * comes through the target, whose own row is the only thing that knows it
   * (§2.2). `null` on a write response, which is a narrower projection.
   */
  level_id: string | null;
  branch_id: string;
  room_id: string | null;
  /**
   * **R97 — طريقة الحضور.** `'in_person'` | `'online'`, with
   * `online_media_mode` non-null exactly when it is `'online'`. Rendered
   * through `deliveryLabel` in `components/scheduling/delivery.tsx` and never
   * hand-written per screen.
   */
  delivery_mode: string;
  online_media_mode: string | null;
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
  /** R50's bound, on the contract since R55. `null` is open-ended. */
  effective_until: string | null;
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
  title: string;
  description?: string | null;
  /**
   * **R109 — the DEFAULT tier for the Sessions this schedule materializes.**
   *
   * Declared here rather than merely spread at the call site: TypeScript does
   * **not** excess-check a spread, so a key absent from this interface travels
   * on the wire while the contract says nothing about it — silent drift of
   * exactly the kind the DTO guard exists to prevent on the other side.
   *
   * Omitted on an update leaves the tier alone; omitted on a create takes the
   * column default, `public`.
   */
  visibility?: string;
  subject_id: string;
  teaching_mode: string;
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
  /** Exactly one target, of the kind the mode names (§4.4c). */
  target_id: string;
  branch_id: string;
  room_id?: string | null;
  /** **R97 — the DEFAULT delivery** for the Sessions this schedule
   *  materializes. Absent is `in_person`, which is what every class scheduled
   *  before this revision was. */
  delivery_mode?: 'in_person' | 'online';
  online_media_mode?: 'audio_video' | 'audio_only' | null;
  /** TD-11 wall-clock `HH:MM` — an ISO instant is refused by the server. */
  start_time: string;
  end_time: string;
  recurrence: string;
  weekdays?: string[];
  /** TD-11 calendar date. For `biweekly_alternating` it also fixes **which**
   *  fortnight is *on* — without it the two halves are indistinguishable (§7). */
  anchor_date?: string | null;
  /** R50's bound, on the contract since R55. Omitted or null is open-ended. */
  effective_until?: string | null;
  academic_year_id: string;
  /**
   * §4.4c — **one primary teacher and any number of assistants**, one table and
   * one rule. An assistant's reach over students is identical to a teacher's;
   * what differs is which of them the schedule calls its own.
   */
  staff?: { user_id: string; position: 'teacher' | 'assistant' }[];
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
/**
 * Edits the schedule, at one of §4.4 (Revision 50)'s two schedule-level scopes.
 *
 * **`all_sessions`** (the default) rewrites future un-overridden Sessions.
 * **`this_and_future`** requires `from_date` and **splits the schedule**: this
 * one is closed the day before, and a successor carrying the new values is
 * anchored at that date with its staff copied. The response is the
 * **successor**, plus `split_from_schedule_id` naming the closed half — so a
 * caller can tell its list now holds two rows where it held one.
 *
 * *This session only* is deliberately not a value here: it is
 * `PATCH /sessions/{id}` in `sessions.ts`, because it edits one occurrence
 * rather than the rule that produced it.
 */
export async function updateCourseSchedule(
  id: string,
  version: number,
  input: Partial<
    Pick<
      CourseScheduleInput,
      // R57 — editable, unlike the scope fields §4.4 freezes.
      | 'title'
      | 'description'
      | 'room_id'
      // R97 — editable, and it resyncs the FUTURE un-protected occurrences.
      | 'delivery_mode'
      | 'online_media_mode'
      | 'start_time'
      | 'end_time'
      | 'recurrence'
      | 'weekdays'
      // The rule's own bounds are part of the rule, so an edit that may change
      // *when* a class recurs must be able to change *between which dates*.
      | 'anchor_date'
      | 'effective_until'
      // **R90 — who staffs it.** Accepted on create and refused here, while the
      // form rendered the controls on both.
      | 'staff'
    >
  > & { scope?: 'all_sessions' | 'this_and_future'; from_date?: string },
  token: string | null,
): Promise<ScheduleWriteResult & { split_from_schedule_id?: string }> {
  return api<ScheduleWriteResult & { split_from_schedule_id?: string }>(
    `/admin/course-schedules/${id}`,
    { method: 'PATCH', token, body: { version, ...input } },
  );
}

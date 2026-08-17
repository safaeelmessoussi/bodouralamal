import { api } from '../lib/api.js';
import type { Page } from './administrative-groups.js';

/**
 * Teaching Groups — the subject-specific split inside a Level (§4.4c, BR-22,
 * TD-3.12, Revision 43).
 *
 * A Subject with **no** groups is taught to the entire Level, so creating these
 * is never a prerequisite for teaching anything. The splits are independent
 * between Subjects: one student sits in an Administrative Group, a Quran group
 * and a Tajweed group at once.
 */

export interface TeachingGroup {
  id: string;
  name: string;
  level_id: string;
  subject_id: string;
  display_order: number | null;
  /** Live members — so a screen answers *how many* without a request per group. */
  member_count: number;
  /** TD-15: sent back on edit; a stale one is a `409`. */
  version: number;
}

/**
 * A student enrolled in the Level holding no seat in this split Subject (BR-22).
 *
 * `administrative_group_id` and `branch_id` travel because the next action is
 * *place this student*, and without them the list names a problem and withholds
 * what is needed to fix it.
 */
export interface UnassignedStudent {
  student_id: string;
  name: string | null;
  administrative_group_id: string;
  branch_id: string;
}

/**
 * The whole split in one read.
 *
 * **`split` is not redundant with `groups.length`.** A Subject with no groups is
 * taught to the entire Level, so an empty `unassigned` there means *the question
 * does not apply*; on a split Subject it means *everyone is placed*. The two
 * render identically without the flag and only one of them is fine.
 */
export interface SubjectSplit {
  groups: TeachingGroup[];
  split: boolean;
  unassigned: UnassignedStudent[];
}

export async function readSubjectSplit(
  levelId: string,
  subjectId: string,
  token: string | null,
): Promise<SubjectSplit> {
  return api<SubjectSplit>(`/admin/levels/${levelId}/subjects/${subjectId}/teaching-groups`, {
    token,
  });
}

/** Super Admin only (R43.3) — a Teaching Group is curriculum structure. */
export async function createTeachingGroup(
  levelId: string,
  subjectId: string,
  input: { name: string; display_order?: number | null },
  token: string | null,
): Promise<TeachingGroup> {
  return api<TeachingGroup>(`/admin/levels/${levelId}/subjects/${subjectId}/teaching-groups`, {
    method: 'POST',
    token,
    body: input,
  });
}

export async function updateTeachingGroup(
  id: string,
  version: number,
  input: { name?: string; display_order?: number | null },
  token: string | null,
): Promise<TeachingGroup> {
  return api<TeachingGroup>(`/admin/teaching-groups/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
}

/**
 * **Answers `200 { released_students }`, not `204`.** Deleting a split returns
 * its members to the `unassigned` list, and BR-22 requires that to be visible —
 * the count is unavailable once the list has been worked through.
 */
export async function deleteTeachingGroup(
  id: string,
  token: string | null,
): Promise<{ released_students: number }> {
  return api<{ released_students: number }>(`/admin/teaching-groups/${id}`, {
    method: 'DELETE',
    token,
  });
}

/** Admin, scoped by the branch the **student** is enrolled at (R43.3). */
export async function addMember(
  groupId: string,
  studentId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/teaching-groups/${groupId}/members`, {
    method: 'POST',
    token,
    body: { student_id: studentId },
  });
}

export async function removeMember(
  groupId: string,
  studentId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/teaching-groups/${groupId}/members/${studentId}`, {
    method: 'DELETE',
    token,
  });
}

/**
 * A circle **listed across Levels and Subjects** — the `حلقات المواد` table row.
 *
 * `TeachingGroup` above carries only the two ids, which is right for the read
 * addressed *by* that pair: the caller already knows them. A flat table does
 * not, so the row names them — as the Category and the Level **separately**,
 * because `levelLabel` owns the `{Category} — {Level}` format and a
 * pre-joined string from the server would be a second implementation of it.
 *
 * **No branch and no مؤطرة, and neither is an omission.** A circle carries no
 * branch (R43.3 — that absence is *why* its authority is split), and staffing is
 * a property of a `CourseSchedule` rather than of the audience it teaches
 * (§4.4c, §20 rule 22).
 */
export interface TeachingGroupRow extends TeachingGroup {
  level_name: string;
  category_name: string;
  subject_name: string;
}

export interface CircleFilters {
  level_id?: string;
  subject_id?: string;
  category_id?: string;
  q?: string;
}

/**
 * `GET /admin/teaching-groups` — **every parameter narrows, none is required.**
 *
 * That is what lets the screen show its data on arrival. Calling it with no
 * filters is the normal case, not a fallback.
 */
export async function listCircles(
  token: string | null,
  page = 1,
  filters: CircleFilters = {},
): Promise<Page<TeachingGroupRow>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return api<Page<TeachingGroupRow>>(`/admin/teaching-groups?${params.toString()}`, { token });
}

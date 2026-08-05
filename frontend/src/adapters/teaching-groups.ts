import { api } from '../lib/api.js';

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

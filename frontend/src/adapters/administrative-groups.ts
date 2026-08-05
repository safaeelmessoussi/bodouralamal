import { api } from '../lib/api.js';

/**
 * Administrative Groups and their rosters (§4.4c, §5.6, TD-3.12, Revision 43).
 *
 * The **organisational** unit inside a Level — it has no room, no teacher and
 * **no capacity**. Those belong to delivery, and §20 rule 22 forbids ever
 * re-conflating the two, which is why nothing resembling `max_students` appears
 * in these types.
 *
 * Types are exactly the endpoint's contract DTO (§16.2), so a field the API
 * stops sending is a type error here rather than an empty cell on the page.
 */

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export interface AdministrativeGroup {
  id: string;
  name: string;
  level_id: string;
  /**
   * **Load-bearing** (§4.4c): the single answer to *which branch is this person
   * at* — the answer `intended_branch_id` deliberately does not give.
   */
  branch_id: string;
  display_order: number | null;
  /** TD-15: loaded with the row, sent back on edit; a stale one is a `409`. */
  version: number;
}

export interface RosterEntry {
  /** The **enrolment** id, not the student's — they must not be confused. */
  id: string;
  student_id: string;
  name: string | null;
  /** An instant, correctly — an enrolment happens at a moment (cf. TD-11). */
  enrolled_at: string;
}

export interface GroupFilters {
  level_id?: string;
  branch_id?: string;
}

export async function listAdministrativeGroups(
  token: string | null,
  page = 1,
  filters: GroupFilters = {},
): Promise<Page<AdministrativeGroup>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return api<Page<AdministrativeGroup>>(`/admin/administrative-groups?${params.toString()}`, {
    token,
  });
}

export interface GroupInput {
  name: string;
  level_id: string;
  branch_id: string;
  display_order?: number | null;
}

export async function createAdministrativeGroup(
  input: GroupInput,
  token: string | null,
): Promise<AdministrativeGroup> {
  return api<AdministrativeGroup>('/admin/administrative-groups', {
    method: 'POST',
    token,
    body: input,
  });
}

/**
 * **Only `name` and `display_order` are editable.** Moving a group between
 * Levels or Branches is a re-creation, not an edit — the server rejects both
 * rather than dropping them, so this signature is the contract, not a
 * convenience.
 */
export async function updateAdministrativeGroup(
  id: string,
  version: number,
  input: { name?: string; display_order?: number | null },
  token: string | null,
): Promise<AdministrativeGroup> {
  return api<AdministrativeGroup>(`/admin/administrative-groups/${id}`, {
    method: 'PATCH',
    token,
    body: { version, ...input },
  });
}

/**
 * TD-5 soft delete, refused with `409 STATE_CONFLICT` while enrolments exist,
 * while a schedule targets the group, or when it is the **last group in a
 * Level** — §4.4b keeps a Level from being emptied back to none.
 */
export async function deleteAdministrativeGroup(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/administrative-groups/${id}`, { method: 'DELETE', token });
}

export async function listRoster(
  groupId: string,
  token: string | null,
  page = 1,
): Promise<Page<RosterEntry>> {
  return api<Page<RosterEntry>>(
    `/admin/administrative-groups/${groupId}/roster?page=${page}&page_size=100`,
    { token },
  );
}

/**
 * **`level_id` is not sent.** The server reads it from the group, so a typo
 * cannot mis-file a student — sending it would make the composite FK the only
 * thing between a mistake and a wrong record.
 */
export async function enrolStudent(
  groupId: string,
  studentId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/administrative-groups/${groupId}/roster`, {
    method: 'POST',
    token,
    body: { student_id: studentId },
  });
}

/** Soft-deletes the enrolment **only** — grades, submissions and Quran logs survive. */
export async function unenrolStudent(
  groupId: string,
  studentId: string,
  token: string | null,
): Promise<void> {
  await api<void>(`/admin/administrative-groups/${groupId}/roster/${studentId}`, {
    method: 'DELETE',
    token,
  });
}

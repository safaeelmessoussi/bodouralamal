import { api } from '../lib/api.js';

/**
 * The Trash — soft-deleted records (§7, TD-5, BR-15, Revision 52).
 *
 * **`restorable` is a server decision and this adapter never second-guesses
 * it.** §7's hazard is that the TD-5 cascade removes relationship rows, and *"a
 * User restored without their links, enrollments and roles is a half-restored,
 * silently broken account."* A client cannot know which deletions cascade — so
 * the screen renders the flag it is given and offers the action only where the
 * server says the operation behind it is complete.
 *
 * **There is no permanent-delete call, and its absence is deliberate.** BR-15's
 * 90-day window is enforced by the purge job; a manual *delete now* would bypass
 * a retention rule that exists for legal and safeguarding reasons.
 */

export interface TrashEntry {
  id: string;
  target_entity: string;
  target_id: string;
  /** A name read from the snapshot. `null` for entities that have none. */
  label: string | null;
  /** An instant — a deletion happens at a moment (cf. TD-11). */
  deleted_at: string;
  deleted_by_id: string | null;
  deleted_by_name: string | null;
  /** BR-15: when the 90-day window purges it permanently. */
  purge_after: string;
  restorable: boolean;
  /** A stable code when `restorable` is false — the screen explains it. */
  restore_blocked_reason: string | null;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number };
}

export interface TrashQuery {
  entity?: string;
  deleted_by?: string;
  from?: string;
  to?: string;
  q?: string;
}

export async function listTrash(
  token: string | null,
  query: TrashQuery = {},
  page = 1,
): Promise<Page<TrashEntry>> {
  const params = new URLSearchParams({ page: String(page), page_size: '25' });
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  return api<Page<TrashEntry>>(`/admin/trash?${params.toString()}`, { token });
}

/** Refused loudly for an entity type whose restoration is not yet complete —
 *  the screen does not offer it, and the server refuses it anyway. */
export async function restoreTrashEntry(
  id: string,
  token: string | null,
): Promise<{ target_entity: string; target_id: string }> {
  return api<{ target_entity: string; target_id: string }>(`/admin/trash/${id}/restore`, {
    method: 'POST',
    token,
  });
}

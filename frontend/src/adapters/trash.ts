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
 * **Permanent deletion is a Super Admin action** (R59.1), and `purgeable` is a
 * server decision on exactly the same footing as `restorable`. Rendering it is a
 * courtesy to the reader; the authority is asserted again on the endpoint, so a
 * crafted request from any other role is refused whether or not a screen ever
 * showed the action.
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
  /** BR-15: when the seven-day window purges it permanently (R133). */
  purge_after: string;
  restorable: boolean;
  /** A stable code when `restorable` is false — the screen explains it. */
  restore_blocked_reason: string | null;
  /** R59.1 — whether a Super Admin may destroy it. Server-decided. */
  purgeable: boolean;
  /** A stable code when `purgeable` is false — the screen explains it. */
  purge_blocked_reason: string | null;
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
  /**
   * Which side of the Trash to read (Owner, 2026-09-02). `actionable` — the
   * server's default — lists rows a restore or purge can actually be performed
   * on; `retained` lists history kept because something references it. The
   * stored rows are the same either way; this is a lens, not a move.
   */
  view?: 'actionable' | 'retained' | 'all';
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

/**
 * **Destroys the record permanently** (R59.1). Irreversible.
 *
 * Offered only where the server said `purgeable`, and refused by the server for
 * any caller who is not a Super Admin — the confirmation dialog in front of it
 * is for the *reader*, never for the security.
 */
export async function purgeTrashEntry(id: string, token: string | null): Promise<void> {
  await api<void>(`/admin/trash/${id}`, { method: 'DELETE', token });
}
